"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Copy, Download, FolderTree, Search, Star, Upload } from "lucide-react";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatRelativeTime, generateId } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface SavedQueryManagerProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface SavedQueryEntry {
  id: string;
  name: string;
  folder: string;
  tags: string[];
  sql: string;
  notes: string;
  starred: boolean;
  createdAt: number;
  updatedAt: number;
}

interface QueryDraft {
  name: string;
  folder: string;
  tags: string;
  sql: string;
  notes: string;
}

const STORAGE_KEY = "datalens-saved-query-manager";

const EMPTY_DRAFT: QueryDraft = {
  name: "",
  folder: "",
  tags: "",
  sql: "",
  notes: "",
};

function isSavedQueryEntry(value: unknown): value is SavedQueryEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as SavedQueryEntry).id === "string" &&
    typeof (value as SavedQueryEntry).name === "string" &&
    typeof (value as SavedQueryEntry).folder === "string" &&
    Array.isArray((value as SavedQueryEntry).tags) &&
    typeof (value as SavedQueryEntry).sql === "string" &&
    typeof (value as SavedQueryEntry).notes === "string" &&
    typeof (value as SavedQueryEntry).starred === "boolean" &&
    typeof (value as SavedQueryEntry).createdAt === "number" &&
    typeof (value as SavedQueryEntry).updatedAt === "number"
  );
}

function readSavedQueries() {
  if (typeof window === "undefined") return [] as SavedQueryEntry[];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isSavedQueryEntry) : [];
  } catch {
    return [];
  }
}

function normalizeTags(input: string) {
  return Array.from(
    new Set(
      input
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

function buildShareUrl(tableName: string, entry: SavedQueryEntry) {
  const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
  const params = new URLSearchParams({
    table: tableName,
    savedQuery: entry.id,
  });
  return `${base}/?${params.toString()}`;
}

export default function SavedQueryManager({
  tableName,
  columns,
}: SavedQueryManagerProps) {
  const [queries, setQueries] = useState<SavedQueryEntry[]>(() => readSavedQueries());
  const [draft, setDraft] = useState<QueryDraft>(EMPTY_DRAFT);
  const [search, setSearch] = useState("");
  const [activeFolder, setActiveFolder] = useState<string>("all");
  const [status, setStatus] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queries));
  }, [queries]);

  const folders = useMemo(
    () =>
      ["all", ...Array.from(new Set(queries.map((query) => query.folder).filter(Boolean))).sort()],
    [queries],
  );

  const filteredQueries = useMemo(() => {
    const needle = deferredSearch.trim().toLowerCase();
    return queries
      .filter((query) => (activeFolder === "all" ? true : query.folder === activeFolder))
      .filter((query) => {
        if (!needle) return true;
        const haystack = [
          query.name,
          query.folder,
          query.tags.join(" "),
          query.sql,
          query.notes,
        ]
          .join("\n")
          .toLowerCase();
        return haystack.includes(needle);
      })
      .sort((left, right) => Number(right.starred) - Number(left.starred) || right.updatedAt - left.updatedAt);
  }, [activeFolder, deferredSearch, queries]);

  function handleSave() {
    const name = draft.name.trim();
    const sql = draft.sql.trim();

    if (!name || !sql) {
      setStatus("A name and SQL text are required.");
      return;
    }

    const now = Date.now();
    setQueries((current) => [
      {
        id: generateId(),
        name,
        folder: draft.folder.trim(),
        tags: normalizeTags(draft.tags),
        sql,
        notes: draft.notes.trim(),
        starred: false,
        createdAt: now,
        updatedAt: now,
      },
      ...current,
    ]);
    setDraft(EMPTY_DRAFT);
    setStatus("Saved query collection updated.");
  }

  function toggleStar(id: string) {
    setQueries((current) =>
      current.map((query) =>
        query.id === id
          ? { ...query, starred: !query.starred, updatedAt: Date.now() }
          : query,
      ),
    );
  }

  async function handleShare(entry: SavedQueryEntry) {
    const shareUrl = buildShareUrl(tableName, entry);
    await navigator.clipboard.writeText(shareUrl);
    setStatus(`Copied share URL for ${entry.name}.`);
  }

  function handleExport() {
    downloadFile(
      JSON.stringify(queries, null, 2),
      `${tableName}-saved-query-collection.json`,
      "application/json;charset=utf-8;",
    );
    setStatus("Exported saved query collection.");
  }

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        throw new Error("Imported collection must be an array of saved queries.");
      }

      const imported = parsed.filter(isSavedQueryEntry);
      setQueries((current) => [...imported, ...current]);
      setStatus("Imported saved query collection.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Import failed.");
    } finally {
      event.target.value = "";
    }
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <FolderTree className="h-6 w-6 text-cyan-600 dark:text-cyan-300" />
            <h2 className="text-xl font-semibold text-slate-950 dark:text-slate-50">
              Manage saved query collections
            </h2>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
            Organize SQL into folders, tags, and notes, star favorites, export and import
            collections, and generate shareable URLs for {tableName}. Schema context tracks{" "}
            {columns.length} columns.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={handleExport} className={BUTTON_CLASS}>
            <Download className="h-4 w-4" />
            Export collection
          </button>
          <label className={`${BUTTON_CLASS} cursor-pointer`}>
            <Upload className="h-4 w-4" />
            Import collection
            <input type="file" accept="application/json" onChange={(event) => void handleImport(event)} className="hidden" />
          </label>
        </div>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(18rem,0.95fr)_minmax(0,1.05fr)]">
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <div className="grid gap-4">
            <input
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              placeholder="Weekly revenue summary"
              className={FIELD_CLASS}
            />
            <input
              value={draft.folder}
              onChange={(event) => setDraft((current) => ({ ...current, folder: event.target.value }))}
              placeholder="Finance"
              className={FIELD_CLASS}
            />
            <input
              value={draft.tags}
              onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))}
              placeholder="finance, monthly, exec"
              className={FIELD_CLASS}
            />
            <textarea
              value={draft.sql}
              onChange={(event) => setDraft((current) => ({ ...current, sql: event.target.value }))}
              placeholder='SELECT month, SUM(revenue) FROM "sales" GROUP BY month;'
              className={`${FIELD_CLASS} min-h-28 resize-none`}
            />
            <textarea
              value={draft.notes}
              onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
              placeholder="Notes, caveats, or business context."
              className={`${FIELD_CLASS} min-h-24 resize-none`}
            />
            <button type="button" onClick={handleSave} className={BUTTON_CLASS}>
              <FolderTree className="h-4 w-4" />
              Save query
            </button>
          </div>

          {status ? (
            <p className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-700 dark:text-cyan-300">
              {status}
            </p>
          ) : null}
        </div>

        <div className="grid gap-4">
          <div className={`${GLASS_CARD_CLASS} p-4`}>
            <label className="relative block">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search saved queries"
                className={`${FIELD_CLASS} pl-11`}
              />
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              {folders.map((folder) => (
                <button
                  key={folder}
                  type="button"
                  onClick={() => setActiveFolder(folder)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition ${
                    activeFolder === folder
                      ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
                      : "border-white/20 bg-white/70 text-slate-600 dark:bg-slate-950/55 dark:text-slate-300"
                  }`}
                >
                  {folder}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            {filteredQueries.length > 0 ? (
              filteredQueries.map((query) => (
                <motion.div
                  key={query.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: ANALYTICS_EASE }}
                  className={`${GLASS_CARD_CLASS} p-4`}
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="flex items-center gap-3">
                        <h3 className="text-base font-semibold text-slate-950 dark:text-slate-50">
                          {query.name}
                        </h3>
                        <button
                          type="button"
                          onClick={() => toggleStar(query.id)}
                          className={`rounded-full border p-1.5 ${
                            query.starred
                              ? "border-amber-400/40 bg-amber-500/10 text-amber-600 dark:text-amber-300"
                              : "border-white/20 bg-white/70 text-slate-500 dark:bg-slate-950/55 dark:text-slate-400"
                          }`}
                          aria-label={query.starred ? `Unstar ${query.name}` : `Star ${query.name}`}
                        >
                          <Star className="h-4 w-4" fill={query.starred ? "currentColor" : "none"} />
                        </button>
                      </div>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                        Folder: {query.folder || "Unfiled"} • {formatRelativeTime(query.updatedAt)}
                      </p>
                      <p className="mt-3 font-mono text-xs text-slate-500 dark:text-slate-400">{query.sql}</p>
                      <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{query.notes}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {query.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full border border-white/20 bg-white/70 px-3 py-1 text-xs font-medium text-slate-600 dark:bg-slate-950/55 dark:text-slate-300"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleShare(query)}
                      className={BUTTON_CLASS}
                    >
                      <Copy className="h-4 w-4" />
                      Share URL
                    </button>
                  </div>
                </motion.div>
              ))
            ) : (
              <div className={`${GLASS_CARD_CLASS} p-4 text-sm text-slate-600 dark:text-slate-300`}>
                No saved queries match the current filters.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
