"use client";

import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bookmark,
  Check,
  Download,
  PencilLine,
  Plus,
  Search,
  Tag,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { formatRelativeTime, generateId } from "@/lib/utils/formatters";

interface SavedQueriesProps {
  onSelectQuery: (sql: string) => void;
}

interface StoredSavedQuery {
  id: string;
  name: string;
  description: string;
  tags: string[];
  sql: string;
  createdAt: number;
  updatedAt: number;
}

interface QueryDraft {
  name: string;
  description: string;
  tags: string;
  sql: string;
}

const STORAGE_KEY = "datalens-saved-queries";

const EMPTY_DRAFT: QueryDraft = {
  name: "",
  description: "",
  tags: "",
  sql: "",
};

function normalizeTags(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function readSavedQueries(): StoredSavedQuery[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item): item is Partial<StoredSavedQuery> => Boolean(item && typeof item === "object"))
      .map((item) => ({
        id: typeof item.id === "string" ? item.id : generateId(),
        name: typeof item.name === "string" ? item.name : "Untitled query",
        description: typeof item.description === "string" ? item.description : "",
        tags: Array.isArray(item.tags)
          ? item.tags.filter((tag): tag is string => typeof tag === "string")
          : [],
        sql: typeof item.sql === "string" ? item.sql : "",
        createdAt:
          typeof item.createdAt === "number" && Number.isFinite(item.createdAt)
            ? item.createdAt
            : Date.now(),
        updatedAt:
          typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt)
            ? item.updatedAt
            : typeof item.createdAt === "number" && Number.isFinite(item.createdAt)
              ? item.createdAt
              : Date.now(),
      }))
      .filter((item) => item.sql.trim().length > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function persistSavedQueries(queries: StoredSavedQuery[]): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queries));
  } catch {
    // Non-critical if storage is unavailable or full.
  }
}

function createDraftFromQuery(query: StoredSavedQuery): QueryDraft {
  return {
    name: query.name,
    description: query.description,
    tags: query.tags.join(", "),
    sql: query.sql,
  };
}

function parseImportedQueries(raw: string): StoredSavedQuery[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("The imported file must contain an array of saved queries.");
  }

  const now = Date.now();

  return parsed
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => {
      const sql = typeof item.sql === "string" ? item.sql.trim() : "";
      if (!sql) return null;

      return {
        id: typeof item.id === "string" ? item.id : generateId(),
        name:
          typeof item.name === "string" && item.name.trim()
            ? item.name.trim()
            : "Imported query",
        description: typeof item.description === "string" ? item.description : "",
        tags: Array.isArray(item.tags)
          ? item.tags.filter((tag): tag is string => typeof tag === "string")
          : [],
        sql,
        createdAt:
          typeof item.createdAt === "number" && Number.isFinite(item.createdAt)
            ? item.createdAt
            : now,
        updatedAt:
          typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt)
            ? item.updatedAt
            : typeof item.createdAt === "number" && Number.isFinite(item.createdAt)
              ? item.createdAt
              : now,
      } satisfies StoredSavedQuery;
    })
    .filter((item): item is StoredSavedQuery => item !== null);
}

export default function SavedQueries({ onSelectQuery }: SavedQueriesProps) {
  const [queries, setQueries] = useState<StoredSavedQuery[]>([]);
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [draft, setDraft] = useState<QueryDraft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<QueryDraft>(EMPTY_DRAFT);
  const [status, setStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    setQueries(readSavedQueries());
  }, []);

  useEffect(() => {
    persistSavedQueries(queries);
  }, [queries]);

  useEffect(() => {
    if (!status) return;

    const timeoutId = window.setTimeout(() => setStatus(null), 2600);
    return () => window.clearTimeout(timeoutId);
  }, [status]);

  const allTags = useMemo(
    () =>
      Array.from(new Set(queries.flatMap((query) => query.tags))).sort((left, right) =>
        left.localeCompare(right)
      ),
    [queries]
  );

  const filteredQueries = useMemo(() => {
    const queryText = deferredSearch.trim().toLowerCase();

    return queries.filter((query) => {
      const matchesTag = activeTag ? query.tags.includes(activeTag) : true;
      if (!matchesTag) return false;
      if (!queryText) return true;

      const haystack = [query.name, query.description, query.sql, query.tags.join(" ")].join("\n");
      return haystack.toLowerCase().includes(queryText);
    });
  }, [activeTag, deferredSearch, queries]);

  const resetCreateDialog = () => {
    setDraft(EMPTY_DRAFT);
    setIsCreateOpen(false);
  };

  const handleCreate = () => {
    const sql = draft.sql.trim();
    const name = draft.name.trim();
    if (!sql || !name) return;

    setQueries((current) => [
      {
        id: generateId(),
        name,
        description: draft.description.trim(),
        tags: normalizeTags(draft.tags),
        sql,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      ...current,
    ]);

    setStatus("Saved query added.");
    resetCreateDialog();
  };

  const beginEdit = (query: StoredSavedQuery) => {
    setEditingId(query.id);
    setEditDraft(createDraftFromQuery(query));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(EMPTY_DRAFT);
  };

  const handleSaveEdit = (id: string) => {
    const sql = editDraft.sql.trim();
    const name = editDraft.name.trim();
    if (!sql || !name) return;

    setQueries((current) =>
      current.map((query) =>
        query.id === id
          ? {
              ...query,
              name,
              description: editDraft.description.trim(),
              tags: normalizeTags(editDraft.tags),
              sql,
              updatedAt: Date.now(),
            }
          : query
      )
    );

    setStatus("Saved query updated.");
    cancelEdit();
  };

  const handleDelete = (id: string) => {
    const query = queries.find((item) => item.id === id);
    if (!query) return;

    if (!window.confirm(`Delete "${query.name}"?`)) {
      return;
    }

    setQueries((current) => current.filter((item) => item.id !== id));
    setStatus("Saved query deleted.");
    if (editingId === id) cancelEdit();
  };

  const handleExport = () => {
    if (queries.length === 0 || typeof window === "undefined") return;

    const blob = new Blob([JSON.stringify(queries, null, 2)], {
      type: "application/json",
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `datalens-saved-queries-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.URL.revokeObjectURL(url);
    setStatus("Saved queries exported.");
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const text = await file.text();
      const imported = parseImportedQueries(text);

      if (imported.length === 0) {
        throw new Error("The selected file does not contain any valid saved queries.");
      }

      startTransition(() => {
        setQueries((current) => {
          const merged = new Map<string, StoredSavedQuery>();

          for (const query of current) {
            merged.set(query.id, query);
          }

          for (const query of imported) {
            merged.set(query.id, query);
          }

          return Array.from(merged.values()).sort((a, b) => b.updatedAt - a.updatedAt);
        });
      });

      setStatus(`Imported ${imported.length} saved quer${imported.length === 1 ? "y" : "ies"}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Import failed.");
    }
  };

  const hasQueries = queries.length > 0;

  return (
    <>
      <section className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-2xl border border-gray-200/60 bg-white/70 backdrop-blur-xl dark:border-gray-700/50 dark:bg-gray-900/70">
        <div className="border-b border-gray-200/60 px-4 py-4 dark:border-gray-700/50">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-amber-50 p-2.5 text-amber-500 dark:bg-amber-950/40 dark:text-amber-300">
                <Bookmark className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                  Saved queries
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Bookmark reusable SQL snippets and bring them back with one click.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleImportClick}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-200"
              >
                <Upload className="h-3.5 w-3.5" />
                Import
              </button>

              <button
                type="button"
                onClick={handleExport}
                disabled={!hasQueries}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-200"
              >
                <Download className="h-3.5 w-3.5" />
                Export
              </button>

              <button
                type="button"
                onClick={() => setIsCreateOpen(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-amber-600"
              >
                <Plus className="h-3.5 w-3.5" />
                Save query
              </button>
            </div>
          </div>

          <div className="relative mt-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search names, descriptions, tags, or SQL..."
              className="w-full rounded-xl border border-gray-200/80 bg-white/90 py-2.5 pl-10 pr-10 text-sm text-gray-700 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/20 dark:border-gray-700/70 dark:bg-gray-800/90 dark:text-gray-200 dark:focus:border-amber-500"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {allTags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setActiveTag(null)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTag === null
                    ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                }`}
              >
                All tags
              </button>

              {allTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setActiveTag((current) => (current === tag ? null : tag))}
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    activeTag === tag
                      ? "bg-amber-500 text-white"
                      : "bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/60"
                  }`}
                >
                  <Tag className="h-3 w-3" />
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <AnimatePresence mode="popLayout">
            {status && (
              <motion.div
                key={status}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="mb-4 rounded-xl border border-emerald-200/70 bg-emerald-50/80 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300"
              >
                {status}
              </motion.div>
            )}
          </AnimatePresence>

          {!hasQueries ? (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200/80 bg-gray-50/70 px-6 text-center dark:border-gray-700/60 dark:bg-gray-800/30"
            >
              <Bookmark className="h-10 w-10 text-gray-300 dark:text-gray-600" />
              <h3 className="mt-4 text-sm font-semibold text-gray-700 dark:text-gray-200">
                No saved queries
              </h3>
              <p className="mt-2 max-w-sm text-sm text-gray-500 dark:text-gray-400">
                Create reusable SQL snippets with names, descriptions, and tags for quick recall.
              </p>
            </motion.div>
          ) : filteredQueries.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200/80 bg-gray-50/70 px-6 text-center dark:border-gray-700/60 dark:bg-gray-800/30"
            >
              <Search className="h-10 w-10 text-gray-300 dark:text-gray-600" />
              <h3 className="mt-4 text-sm font-semibold text-gray-700 dark:text-gray-200">
                No saved queries match
              </h3>
              <p className="mt-2 max-w-sm text-sm text-gray-500 dark:text-gray-400">
                Try a different search term or clear the active tag filter.
              </p>
            </motion.div>
          ) : (
            <motion.div layout className="space-y-3">
              <AnimatePresence initial={false}>
                {filteredQueries.map((query, index) => {
                  const isEditing = editingId === query.id;

                  return (
                    <motion.div
                      key={query.id}
                      layout
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.98 }}
                      transition={{ duration: 0.2, delay: index * 0.03 }}
                      className="rounded-2xl border border-gray-200/70 bg-white/85 p-4 dark:border-gray-700/60 dark:bg-gray-800/70"
                    >
                      {isEditing ? (
                        <div className="space-y-3">
                          <input
                            type="text"
                            value={editDraft.name}
                            onChange={(event) =>
                              setEditDraft((current) => ({ ...current, name: event.target.value }))
                            }
                            placeholder="Name"
                            className="w-full rounded-xl border border-gray-200/80 bg-white/90 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/20 dark:border-gray-700/70 dark:bg-gray-900/70 dark:text-gray-200 dark:focus:border-amber-500"
                          />

                          <textarea
                            value={editDraft.description}
                            onChange={(event) =>
                              setEditDraft((current) => ({
                                ...current,
                                description: event.target.value,
                              }))
                            }
                            placeholder="Description"
                            rows={2}
                            className="w-full resize-none rounded-xl border border-gray-200/80 bg-white/90 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/20 dark:border-gray-700/70 dark:bg-gray-900/70 dark:text-gray-200 dark:focus:border-amber-500"
                          />

                          <input
                            type="text"
                            value={editDraft.tags}
                            onChange={(event) =>
                              setEditDraft((current) => ({ ...current, tags: event.target.value }))
                            }
                            placeholder="tags, comma, separated"
                            className="w-full rounded-xl border border-gray-200/80 bg-white/90 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/20 dark:border-gray-700/70 dark:bg-gray-900/70 dark:text-gray-200 dark:focus:border-amber-500"
                          />

                          <textarea
                            value={editDraft.sql}
                            onChange={(event) =>
                              setEditDraft((current) => ({ ...current, sql: event.target.value }))
                            }
                            placeholder="SELECT * FROM ..."
                            rows={6}
                            className="w-full rounded-xl border border-gray-200/80 bg-gray-950 px-3 py-3 font-mono text-xs text-gray-100 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/20 dark:border-gray-700/70"
                          />

                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              onClick={cancelEdit}
                              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-200"
                            >
                              <X className="h-3.5 w-3.5" />
                              Cancel
                            </button>

                            <button
                              type="button"
                              onClick={() => handleSaveEdit(query.id)}
                              disabled={!editDraft.name.trim() || !editDraft.sql.trim()}
                              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Check className="h-3.5 w-3.5" />
                              Save changes
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <h3 className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100">
                                  {query.name}
                                </h3>
                                <span className="rounded-full bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-500 dark:bg-gray-700/60 dark:text-gray-300">
                                  {formatRelativeTime(query.updatedAt)}
                                </span>
                              </div>

                              {query.description && (
                                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                                  {query.description}
                                </p>
                              )}
                            </div>

                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => beginEdit(query)}
                                className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-700/70 dark:hover:text-gray-200"
                                aria-label={`Edit ${query.name}`}
                              >
                                <PencilLine className="h-4 w-4" />
                              </button>

                              <button
                                type="button"
                                onClick={() => handleDelete(query.id)}
                                className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-gray-500 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                                aria-label={`Delete ${query.name}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>

                          {query.tags.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {query.tags.map((tag) => (
                                <button
                                  key={tag}
                                  type="button"
                                  onClick={() => setActiveTag(tag)}
                                  className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/60"
                                >
                                  <Tag className="h-3 w-3" />
                                  {tag}
                                </button>
                              ))}
                            </div>
                          )}

                          <pre className="overflow-x-auto rounded-xl border border-gray-200/60 bg-gray-50/90 px-3 py-3 font-mono text-xs leading-5 text-gray-600 dark:border-gray-700/60 dark:bg-gray-950/70 dark:text-gray-300">
                            {query.sql}
                          </pre>

                          <div className="flex flex-wrap justify-between gap-2">
                            <p className="text-xs text-gray-400 dark:text-gray-500">
                              Created {formatRelativeTime(query.createdAt)}
                            </p>

                            <button
                              type="button"
                              onClick={() => onSelectQuery(query.sql)}
                              className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-sky-600"
                            >
                              Use query
                            </button>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </motion.div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(event) => void handleImport(event)}
        />
      </section>

      <AnimatePresence>
        {isCreateOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/55 p-4 backdrop-blur-sm"
            onClick={resetCreateDialog}
          >
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              onClick={(event) => event.stopPropagation()}
              className="w-full max-w-2xl rounded-3xl border border-gray-200/70 bg-white p-6 shadow-2xl dark:border-gray-700/60 dark:bg-gray-900"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Save query
                  </h3>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    Add a reusable SQL snippet with a label, short description, and tag set.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={resetCreateDialog}
                  className="rounded-xl p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-5 space-y-4">
                <input
                  type="text"
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="Revenue by month"
                  className="w-full rounded-xl border border-gray-200/80 bg-white/90 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/20 dark:border-gray-700/70 dark:bg-gray-800/90 dark:text-gray-200 dark:focus:border-amber-500"
                />

                <textarea
                  value={draft.description}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, description: event.target.value }))
                  }
                  placeholder="Short note about what this query answers."
                  rows={3}
                  className="w-full resize-none rounded-xl border border-gray-200/80 bg-white/90 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/20 dark:border-gray-700/70 dark:bg-gray-800/90 dark:text-gray-200 dark:focus:border-amber-500"
                />

                <input
                  type="text"
                  value={draft.tags}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, tags: event.target.value }))
                  }
                  placeholder="finance, monthly, executive"
                  className="w-full rounded-xl border border-gray-200/80 bg-white/90 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/20 dark:border-gray-700/70 dark:bg-gray-800/90 dark:text-gray-200 dark:focus:border-amber-500"
                />

                <textarea
                  value={draft.sql}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, sql: event.target.value }))
                  }
                  placeholder="SELECT * FROM orders LIMIT 100;"
                  rows={8}
                  className="w-full rounded-2xl border border-gray-200/80 bg-gray-950 px-4 py-3 font-mono text-xs text-gray-100 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/20 dark:border-gray-700/70"
                />
              </div>

              <div className="mt-6 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={resetCreateDialog}
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-200"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={!draft.name.trim() || !draft.sql.trim()}
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" />
                  Save query
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
