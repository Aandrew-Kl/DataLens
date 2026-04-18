"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bookmark,
  Download,
  FileJson,
  Filter,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import {
  clearSyncFlag,
  createSyncFailureNotifier,
  hasPendingSync,
  markPendingSync,
} from "@/lib/sync-feedback";
import { downloadFile } from "@/lib/utils/export";
import { generateId } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface DataBookmarksProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface ViewFilter {
  id: string;
  column: string;
  operator: "=" | "!=" | "contains" | ">" | "<";
  value: string;
}

interface ViewState {
  selectedTab: string;
  filters: ViewFilter[];
  sortColumn: string;
  sortDirection: "asc" | "desc";
  selectedColumns: string[];
}

interface ViewBookmark {
  id: string;
  name: string;
  description: string;
  timestamp: number;
  state: ViewState;
  synced?: boolean;
}

type Notice = string | null;

const EASE = [0.22, 1, 0.36, 1] as const;
const listeners = new Set<() => void>();
const tabs = ["overview", "table", "quality", "charts", "transforms"];
const notifyBookmarkSyncFailure = createSyncFailureNotifier("bookmark");

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitChange() {
  listeners.forEach((listener) => listener());
}

function bookmarksKey(tableName: string) {
  return `datalens:bookmarks:${tableName}`;
}

function currentViewKey(tableName: string) {
  return `datalens:view-state:${tableName}`;
}

function readBookmarks(tableName: string): ViewBookmark[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(bookmarksKey(tableName));
    return raw ? (JSON.parse(raw) as ViewBookmark[]) : [];
  } catch {
    return [];
  }
}

function writeBookmarks(tableName: string, bookmarks: ViewBookmark[]) {
  if (typeof window === "undefined") return true;

  try {
    window.localStorage.setItem(bookmarksKey(tableName), JSON.stringify(bookmarks));
    emitChange();
    return true;
  } catch {
    return false;
  }
}

function clearBookmarkSyncState(bookmarks: ViewBookmark[]): ViewBookmark[] {
  return bookmarks.map((bookmark) => clearSyncFlag(bookmark));
}

function markBookmarksPending(bookmarks: ViewBookmark[], ids: string[]) {
  const pendingIds = new Set(ids);
  return bookmarks.map((bookmark) =>
    pendingIds.has(bookmark.id) ? markPendingSync(bookmark) : bookmark,
  );
}

function defaultViewState(columns: ColumnProfile[]): ViewState {
  return {
    selectedTab: "overview",
    filters: [],
    sortColumn: columns[0]?.name ?? "",
    sortDirection: "asc",
    selectedColumns: columns.slice(0, 6).map((column) => column.name),
  };
}

function readViewState(tableName: string, columns: ColumnProfile[]): ViewState {
  if (typeof window === "undefined") return defaultViewState(columns);
  try {
    const raw = window.localStorage.getItem(currentViewKey(tableName));
    return raw ? (JSON.parse(raw) as ViewState) : defaultViewState(columns);
  } catch {
    return defaultViewState(columns);
  }
}

function writeViewState(tableName: string, state: ViewState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(currentViewKey(tableName), JSON.stringify(state));
  window.dispatchEvent(new CustomEvent("datalens:bookmark-restore", { detail: { tableName, state } }));
  emitChange();
}

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function DataBookmarks({ tableName, columns }: DataBookmarksProps) {
  const currentView = useSyncExternalStore(
    subscribe,
    () => readViewState(tableName, columns),
    () => defaultViewState(columns),
  );
  const [bookmarks, setBookmarks] = useState<ViewBookmark[]>(() => readBookmarks(tableName));
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const pendingBookmarkCount = bookmarks.filter(hasPendingSync).length;

  useEffect(() => {
    setBookmarks(readBookmarks(tableName));
  }, [tableName]);

  function updateView(nextState: ViewState) {
    writeViewState(tableName, nextState);
  }

  function toggleColumn(columnName: string) {
    const exists = currentView.selectedColumns.includes(columnName);
    const selectedColumns = exists
      ? currentView.selectedColumns.filter((nameValue) => nameValue !== columnName)
      : [...currentView.selectedColumns, columnName];
    updateView({ ...currentView, selectedColumns });
  }

  function addFilter() {
    const nextFilter: ViewFilter = {
      id: generateId(),
      column: columns[0]?.name ?? "",
      operator: "=",
      value: "",
    };
    updateView({ ...currentView, filters: [...currentView.filters, nextFilter] });
  }

  function updateFilter(filterId: string, patch: Partial<ViewFilter>) {
    updateView({
      ...currentView,
      filters: currentView.filters.map((filter) => (filter.id === filterId ? { ...filter, ...patch } : filter)),
    });
  }

  function removeFilter(filterId: string) {
    updateView({ ...currentView, filters: currentView.filters.filter((filter) => filter.id !== filterId) });
  }

  function saveBookmark() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNotice("Bookmark name is required.");
      return;
    }

    const bookmark: ViewBookmark = {
      id: editingId ?? generateId(),
      name: trimmedName,
      description: description.trim(),
      timestamp: Date.now(),
      state: currentView,
    };

    const nextBookmarks = editingId
      ? bookmarks.map((entry) => (entry.id === editingId ? bookmark : entry))
      : [bookmark, ...bookmarks];

    const syncedBookmarks = clearBookmarkSyncState(nextBookmarks);
    const didSync = writeBookmarks(tableName, syncedBookmarks);

    if (didSync) {
      setBookmarks(syncedBookmarks);
    } else {
      notifyBookmarkSyncFailure();
      setBookmarks(markBookmarksPending(nextBookmarks, [bookmark.id]));
    }

    setEditingId(null);
    setName("");
    setDescription("");
    setNotice(
      didSync
        ? editingId
          ? "Bookmark updated."
          : "Bookmark saved."
        : editingId
          ? "Bookmark updated locally. Sync pending."
          : "Bookmark saved locally. Sync pending.",
    );
  }

  function restoreBookmark(bookmark: ViewBookmark) {
    writeViewState(tableName, bookmark.state);
    setNotice(`Restored "${bookmark.name}".`);
  }

  function startEditing(bookmark: ViewBookmark) {
    setEditingId(bookmark.id);
    setName(bookmark.name);
    setDescription(bookmark.description);
    setNotice(`Editing "${bookmark.name}". Save to overwrite it.`);
  }

  function deleteBookmark(bookmarkId: string) {
    const nextBookmarks = bookmarks.filter((bookmark) => bookmark.id !== bookmarkId);
    const syncedBookmarks = clearBookmarkSyncState(nextBookmarks);
    const didSync = writeBookmarks(tableName, syncedBookmarks);

    if (didSync) {
      setBookmarks(syncedBookmarks);
    } else {
      notifyBookmarkSyncFailure();
      setBookmarks(markBookmarksPending(bookmarks, [bookmarkId]));
    }

    if (editingId === bookmarkId) {
      setEditingId(null);
      setName("");
      setDescription("");
    }
    setNotice(didSync ? "Bookmark deleted." : "Bookmark delete could not be synced.");
  }

  function exportBookmarks() {
    downloadFile(JSON.stringify(bookmarks, null, 2), `${tableName}-bookmarks.json`, "application/json;charset=utf-8");
  }

  async function importBookmarks(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const parsed = JSON.parse(await file.text()) as ViewBookmark[];
    if (!Array.isArray(parsed)) {
      setNotice("Bookmark import must be a JSON array.");
      return;
    }
    const nextBookmarks = [...parsed, ...bookmarks];
    const syncedBookmarks = clearBookmarkSyncState(nextBookmarks);
    const didSync = writeBookmarks(tableName, syncedBookmarks);

    if (didSync) {
      setBookmarks(syncedBookmarks);
    } else {
      notifyBookmarkSyncFailure(parsed.length);
      setBookmarks(markBookmarksPending(nextBookmarks, parsed.map((bookmark) => bookmark.id)));
    }

    setNotice(
      didSync
        ? `Imported ${parsed.length} bookmark${parsed.length === 1 ? "" : "s"}.`
        : `Imported ${parsed.length} bookmark${parsed.length === 1 ? "" : "s"} locally. Sync pending.`,
    );
    event.target.value = "";
  }

  function syncPendingBookmarks() {
    if (pendingBookmarkCount === 0) {
      return;
    }

    const syncedBookmarks = clearBookmarkSyncState(bookmarks);
    if (writeBookmarks(tableName, syncedBookmarks)) {
      setBookmarks(syncedBookmarks);
      setNotice("Bookmarks synced.");
      return;
    }

    notifyBookmarkSyncFailure(pendingBookmarkCount);
  }

  return (
    <section className="overflow-hidden rounded-[2rem] border border-white/20 bg-white/60 shadow-2xl shadow-slate-950/10 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45">
      <div className="border-b border-white/15 px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300">
            <Bookmark className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">Data Bookmarks</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950 dark:text-slate-50">Saved views for {tableName}</h2>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Capture the current tab, filters, sort order, and visible columns into reusable named views stored in localStorage.
          </p>
          <button
            type="button"
            onClick={syncPendingBookmarks}
            disabled={pendingBookmarkCount === 0}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/20 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-white/40 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200"
          >
            <RotateCcw className="h-4 w-4" />
            Sync now
          </button>
        </div>
      </div>

      <div className="space-y-5 px-5 py-5">
        {notice ? <div className="rounded-2xl border border-fuchsia-400/30 bg-fuchsia-500/10 px-4 py-3 text-sm text-fuchsia-700 dark:text-fuchsia-300">{notice}</div> : null}

        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }} className="grid gap-4 rounded-[1.75rem] border border-white/15 bg-white/50 p-4 dark:bg-slate-900/40 lg:grid-cols-[1.2fr_0.9fr]">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Selected tab</span>
                <select value={currentView.selectedTab} onChange={(event) => updateView({ ...currentView, selectedTab: event.target.value })} className="w-full rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/60 dark:text-slate-50">
                  {tabs.map((tab) => <option key={tab} value={tab}>{tab}</option>)}
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Sort</span>
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <select value={currentView.sortColumn} onChange={(event) => updateView({ ...currentView, sortColumn: event.target.value })} className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/60 dark:text-slate-50">
                    {columns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}
                  </select>
                  <select value={currentView.sortDirection} onChange={(event) => updateView({ ...currentView, sortDirection: event.target.value as ViewState["sortDirection"] })} className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/60 dark:text-slate-50">
                    <option value="asc">ASC</option>
                    <option value="desc">DESC</option>
                  </select>
                </div>
              </label>
            </div>

            <div className="space-y-3 rounded-[1.5rem] border border-white/15 bg-white/40 p-4 dark:bg-slate-900/40">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Filters</h3>
                <button type="button" onClick={addFilter} className="inline-flex items-center gap-2 rounded-2xl border border-white/20 px-3 py-2 text-sm text-slate-700 transition hover:bg-white/40 dark:text-slate-200">
                  <Plus className="h-4 w-4" />
                  Add filter
                </button>
              </div>
              {currentView.filters.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">No filters in this view.</p> : null}
              {currentView.filters.map((filter) => (
                <div key={filter.id} className="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto]">
                  <select value={filter.column} onChange={(event) => updateFilter(filter.id, { column: event.target.value })} className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/60 dark:text-slate-50">
                    {columns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}
                  </select>
                  <select value={filter.operator} onChange={(event) => updateFilter(filter.id, { operator: event.target.value as ViewFilter["operator"] })} className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/60 dark:text-slate-50">
                    <option value="=">=</option>
                    <option value="!=">!=</option>
                    <option value="contains">contains</option>
                    <option value=">">{">"}</option>
                    <option value="<">{"<"}</option>
                  </select>
                  <input value={filter.value} onChange={(event) => updateFilter(filter.id, { value: event.target.value })} placeholder="Value" className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/60 dark:text-slate-50" />
                  <button type="button" onClick={() => removeFilter(filter.id)} className="rounded-2xl border border-rose-300/40 bg-rose-500/10 px-3 py-3 text-rose-700 transition hover:bg-rose-500/15 dark:text-rose-300">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                <Filter className="h-4 w-4" />
                Visible columns
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {columns.map((column) => (
                  <label key={column.name} className="flex items-center gap-3 rounded-2xl border border-white/15 bg-white/40 px-3 py-2.5 text-sm text-slate-700 dark:bg-slate-900/35 dark:text-slate-200">
                    <input type="checkbox" checked={currentView.selectedColumns.includes(column.name)} onChange={() => toggleColumn(column.name)} className="h-4 w-4 rounded border-white/20 bg-transparent" />
                    <span>{column.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-[1.5rem] border border-white/15 bg-slate-950/5 p-4 dark:bg-white/5">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Bookmark name" className="w-full rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/60 dark:text-slate-50" />
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} placeholder="What makes this view useful?" className="w-full rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/60 dark:text-slate-50" />
            <button type="button" onClick={saveBookmark} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-fuchsia-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-fuchsia-500">
              <Bookmark className="h-4 w-4" />
              {editingId ? "Update bookmark" : "Save bookmark"}
            </button>
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={exportBookmarks} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/20 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-white/40 dark:text-slate-200">
                <Download className="h-4 w-4" />
                Export JSON
              </button>
              <label htmlFor={`bookmark-import-${tableName}`} className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-white/20 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-white/40 dark:text-slate-200">
                <Upload className="h-4 w-4" />
                Import JSON
              </label>
            </div>
            <input id={`bookmark-import-${tableName}`} type="file" accept="application/json" onChange={(event) => void importBookmarks(event)} className="hidden" />
            <button type="button" onClick={() => updateView(defaultViewState(columns))} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/20 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-white/40 dark:text-slate-200">
              <RotateCcw className="h-4 w-4" />
              Reset current view
            </button>
          </div>
        </motion.div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Saved bookmarks</h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {bookmarks.length} stored locally{pendingBookmarkCount > 0 ? ` • ${pendingBookmarkCount} need sync` : ""}
            </span>
          </div>
          <AnimatePresence initial={false}>
            {bookmarks.length === 0 ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-[1.75rem] border border-dashed border-white/20 bg-white/35 px-6 py-10 text-center text-sm text-slate-500 dark:bg-slate-900/30 dark:text-slate-400">
                No saved views yet. Configure the current view, then bookmark it.
              </motion.div>
            ) : (
              bookmarks.map((bookmark) => (
                <motion.article key={bookmark.id} layout initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }} transition={{ duration: 0.25, ease: EASE }} className="rounded-[1.5rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/35">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <FileJson className="h-4 w-4 text-fuchsia-600 dark:text-fuchsia-300" />
                        <h4 className="text-base font-semibold text-slate-950 dark:text-slate-50">{bookmark.name}</h4>
                        {bookmark.synced === false ? (
                          <span role="img" aria-label="Needs sync" title="Needs sync">
                            🔄
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{bookmark.description || "No description."}</p>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span className="rounded-full bg-white/50 px-2.5 py-1 dark:bg-slate-950/60">{formatTimestamp(bookmark.timestamp)}</span>
                        <span className="rounded-full bg-white/50 px-2.5 py-1 dark:bg-slate-950/60">{bookmark.state.selectedColumns.length} columns</span>
                        <span className="rounded-full bg-white/50 px-2.5 py-1 dark:bg-slate-950/60">{bookmark.state.filters.length} filters</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => restoreBookmark(bookmark)} className="inline-flex items-center gap-2 rounded-2xl border border-white/20 px-3 py-2 text-sm text-slate-700 transition hover:bg-white/40 dark:text-slate-200">
                        <RotateCcw className="h-4 w-4" />
                        Restore
                      </button>
                      <button type="button" onClick={() => startEditing(bookmark)} className="inline-flex items-center gap-2 rounded-2xl border border-white/20 px-3 py-2 text-sm text-slate-700 transition hover:bg-white/40 dark:text-slate-200">
                        <Pencil className="h-4 w-4" />
                        Edit
                      </button>
                      <button type="button" onClick={() => deleteBookmark(bookmark.id)} className="inline-flex items-center gap-2 rounded-2xl border border-rose-300/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 transition hover:bg-rose-500/15 dark:text-rose-300">
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </button>
                    </div>
                  </div>
                </motion.article>
              ))
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
