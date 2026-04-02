"use client";

import { useDeferredValue, useMemo, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { motion } from "framer-motion";
import { Check, Clock3, Code2, Download, History, LibraryBig, Loader2, PencilLine, Play, Plus, Save, Sparkles, Trash2, X } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { exportToCSV } from "@/lib/utils/export";
import { formatDuration, formatNumber, formatRelativeTime, generateId, truncate } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface SQLPlaygroundProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface QueryTab {
  id: string;
  name: string;
  sql: string;
  cursor: number;
  rows: Record<string, unknown>[];
  headers: string[];
  durationMs: number | null;
  error: string | null;
  rowCount: number;
  running: boolean;
}

interface SavedSnippet {
  id: string;
  name: string;
  description: string;
  sql: string;
  createdAt: number;
}

interface HistoryEntry {
  id: string;
  tabName: string;
  sql: string;
  timestamp: number;
  durationMs: number;
  rowCount: number;
  error?: string;
}

const ease = [0.16, 1, 0.3, 1] as const;
const SNIPPETS_KEY = "datalens-sql-playground-snippets";
const HISTORY_KEY = "datalens-sql-playground-history";
const panelClass =
  "overflow-hidden rounded-[28px] border border-white/20 bg-white/70 shadow-[0_24px_90px_-48px_rgba(15,23,42,0.7)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const fieldClass =
  "w-full rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:border-slate-700/70 dark:bg-slate-950/60 dark:text-slate-100";
const sessionListeners = new Map<string, Set<() => void>>();

function readSessionValue<T>(key: string, fallback: T) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeSessionValue<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(key, JSON.stringify(value));
  sessionListeners.get(key)?.forEach((listener) => listener());
}

function subscribeSessionValue(key: string, callback: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const listeners = sessionListeners.get(key) ?? new Set<() => void>();
  listeners.add(callback);
  sessionListeners.set(key, listeners);
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea === window.sessionStorage && event.key === key) callback();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", onStorage);
  };
}

function useSessionValue<T>(key: string, fallback: T) {
  const value = useSyncExternalStore(
    (callback) => subscribeSessionValue(key, callback),
    () => readSessionValue(key, fallback),
    () => fallback,
  );
  return [value, (nextValue: T) => writeSessionValue(key, nextValue)] as const;
}

function defaultSql(tableName: string) {
  return `SELECT *\nFROM "${tableName}"\nLIMIT 100;`;
}

function createTab(tableName: string, index: number): QueryTab {
  return { id: generateId(), name: `Query ${index}`, sql: defaultSql(tableName), cursor: 0, rows: [], headers: [], durationMs: null, error: null, rowCount: 0, running: false };
}

function collectHeaders(rows: Record<string, unknown>[]) {
  return Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
}

function getTokenRange(sql: string, cursor: number) {
  let start = cursor;
  let end = cursor;
  while (start > 0 && /[A-Za-z0-9_]/.test(sql[start - 1] ?? "")) start -= 1;
  while (end < sql.length && /[A-Za-z0-9_]/.test(sql[end] ?? "")) end += 1;
  return { start, end, token: sql.slice(start, end) };
}

function buildSuggestions(token: string, tableName: string, columns: ColumnProfile[]) {
  const query = token.trim().toLowerCase();
  if (!query) return [];
  const pool = [tableName, ...columns.map((column) => column.name), "SELECT", "FROM", "WHERE", "GROUP BY", "ORDER BY", "LIMIT", "COUNT", "AVG", "SUM"];
  return Array.from(new Set(pool)).filter((item) => item.toLowerCase().includes(query) && item.toLowerCase() !== query).slice(0, 8);
}

function suggestFixes(error: string, tableName: string, columns: ColumnProfile[]) {
  const lowered = error.toLowerCase();
  if (lowered.includes("catalog") || lowered.includes("table")) return [`Check the table name. Active table: "${tableName}".`];
  if (lowered.includes("binder") || lowered.includes("column")) return [`Verify column names against: ${columns.map((column) => column.name).slice(0, 6).join(", ")}.`];
  if (lowered.includes("parser")) return ["DuckDB rejected the SQL syntax. Check commas, aliases, and missing clauses."];
  return ["Review the query around the highlighted clause or start from a template and re-run."];
}

function buildTemplates(tableName: string, columns: ColumnProfile[]) {
  const firstColumn = columns[0]?.name ?? "column_name";
  const numberColumn = columns.find((column) => column.type === "number")?.name ?? firstColumn;
  const categoryColumn = columns.find((column) => column.type === "string" || column.type === "boolean")?.name ?? firstColumn;
  const dateColumn = columns.find((column) => column.type === "date")?.name ?? firstColumn;
  return [
    { id: "top", label: "Top N", sql: `SELECT *\nFROM "${tableName}"\nORDER BY "${numberColumn}" DESC\nLIMIT 20;` },
    { id: "group", label: "Group By", sql: `SELECT "${categoryColumn}", COUNT(*) AS row_count, AVG("${numberColumn}") AS avg_value\nFROM "${tableName}"\nGROUP BY "${categoryColumn}"\nORDER BY row_count DESC;` },
    { id: "join", label: "Join", sql: `WITH base AS (\n  SELECT * FROM "${tableName}"\n)\nSELECT a.*, b."${firstColumn}" AS joined_value\nFROM base AS a\nLEFT JOIN base AS b ON a."${firstColumn}" = b."${firstColumn}"\nLIMIT 50;` },
    { id: "window", label: "Window Function", sql: `SELECT *,\n  ROW_NUMBER() OVER (PARTITION BY "${categoryColumn}" ORDER BY "${numberColumn}" DESC) AS rank_in_group\nFROM "${tableName}"\nLIMIT 100;` },
    { id: "pivot", label: "Pivot", sql: `SELECT DATE_TRUNC('month', TRY_CAST("${dateColumn}" AS TIMESTAMP)) AS month_bucket,\n  "${categoryColumn}",\n  SUM(TRY_CAST("${numberColumn}" AS DOUBLE)) AS total_value\nFROM "${tableName}"\nGROUP BY 1, 2\nORDER BY 1, 2;` },
  ] as const;
}

function ResultStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white/65 p-4 shadow-sm backdrop-blur-sm dark:border-slate-700/70 dark:bg-slate-950/35">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-2 text-xl font-semibold text-slate-900 dark:text-slate-100">{value}</p>
    </div>
  );
}

export default function SQLPlayground({ tableName, columns }: SQLPlaygroundProps) {
  const [tabs, setTabs] = useState<QueryTab[]>([createTab(tableName, 1)]);
  const [activeTabId, setActiveTabId] = useState(tabs[0]?.id ?? "");
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [snippetName, setSnippetName] = useState("");
  const [snippetDescription, setSnippetDescription] = useState("");
  const [copiedSnippetId, setCopiedSnippetId] = useState<string | null>(null);
  const [snippets, setSnippets] = useSessionValue<SavedSnippet[]>(SNIPPETS_KEY, []);
  const [history, setHistory] = useSessionValue<HistoryEntry[]>(HISTORY_KEY, []);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const deferredSql = useDeferredValue(activeTab?.sql ?? "");
  const templates = useMemo(() => buildTemplates(tableName, columns), [tableName, columns]);
  const tokenRange = activeTab ? getTokenRange(activeTab.sql, activeTab.cursor) : { start: 0, end: 0, token: "" };
  const suggestions = useMemo(() => buildSuggestions(tokenRange.token, tableName, columns), [tokenRange.token, tableName, columns]);
  const historyPreview = history.slice().sort((left, right) => right.timestamp - left.timestamp).slice(0, 8);

  function updateTab(tabId: string, updater: (tab: QueryTab) => QueryTab) {
    setTabs((current) => current.map((tab) => (tab.id === tabId ? updater(tab) : tab)));
  }

  function addTab() {
    const next = createTab(tableName, tabs.length + 1);
    setTabs((current) => [...current, next]);
    setActiveTabId(next.id);
    setRenamingTabId(next.id);
  }

  function removeTab(tabId: string) {
    if (tabs.length === 1) return;
    const remaining = tabs.filter((tab) => tab.id !== tabId);
    setTabs(remaining);
    if (activeTabId === tabId) setActiveTabId(remaining[Math.max(0, remaining.length - 1)]?.id ?? "");
    if (renamingTabId === tabId) setRenamingTabId(null);
  }

  async function runTab(tabId: string) {
    const tab = tabs.find((item) => item.id === tabId);
    if (!tab || !tab.sql.trim()) return;
    updateTab(tabId, (current) => ({ ...current, running: true, error: null }));
    const startedAt = performance.now();
    try {
      const rows = await runQuery(tab.sql);
      const durationMs = performance.now() - startedAt;
      updateTab(tabId, (current) => ({ ...current, rows, headers: collectHeaders(rows), rowCount: rows.length, durationMs, error: null, running: false }));
      setHistory([{ id: generateId(), tabName: tab.name, sql: tab.sql, timestamp: Date.now(), durationMs, rowCount: rows.length }, ...history].slice(0, 20));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Query failed.";
      updateTab(tabId, (current) => ({ ...current, rows: [], headers: [], rowCount: 0, durationMs: null, error: message, running: false }));
      setHistory([{ id: generateId(), tabName: tab.name, sql: tab.sql, timestamp: Date.now(), durationMs: 0, rowCount: 0, error: message }, ...history].slice(0, 20));
    }
  }

  function saveSnippet() {
    if (!activeTab?.sql.trim()) return;
    const nextSnippet: SavedSnippet = {
      id: generateId(),
      name: snippetName.trim() || activeTab.name,
      description: snippetDescription.trim() || "Saved from SQL playground",
      sql: activeTab.sql,
      createdAt: Date.now(),
    };
    setSnippets([nextSnippet, ...snippets].slice(0, 30));
    setSnippetName("");
    setSnippetDescription("");
    setCopiedSnippetId(nextSnippet.id);
    window.setTimeout(() => setCopiedSnippetId((current) => (current === nextSnippet.id ? null : current)), 1400);
  }

  function insertTemplate(sql: string) {
    if (!activeTab) return;
    updateTab(activeTab.id, (current) => ({ ...current, sql, cursor: sql.length, error: null }));
  }

  function applySuggestion(suggestion: string) {
    if (!activeTab) return;
    const nextSql = `${activeTab.sql.slice(0, tokenRange.start)}${suggestion}${activeTab.sql.slice(tokenRange.end)}`;
    updateTab(activeTab.id, (current) => ({ ...current, sql: nextSql, cursor: tokenRange.start + suggestion.length }));
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!activeTab) return;
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void runTab(activeTab.id);
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveSnippet();
    }
  }

  return (
    <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease }} className={`${panelClass} bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.18),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.78),rgba(248,250,252,0.72))] dark:bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.12),transparent_26%),linear-gradient(180deg,rgba(2,6,23,0.88),rgba(15,23,42,0.82))]`}>
      <div className="border-b border-white/30 px-6 py-5 dark:border-white/10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-300">
              <Sparkles className="h-3.5 w-3.5" />
              SQL Playground
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-slate-900 dark:text-slate-100">Tabbed SQL workbench for {tableName}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">Run DuckDB queries, keep snippet and execution history in session storage, and work across multiple query tabs with lightweight autocomplete.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {templates.map((template) => (
              <button key={template.id} type="button" onClick={() => insertTemplate(template.sql)} className="rounded-full border border-slate-200/70 bg-white/75 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-cyan-400/40 hover:text-cyan-700 dark:border-slate-700/70 dark:bg-slate-950/55 dark:text-slate-200 dark:hover:text-cyan-300">
                {template.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-6 px-6 py-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            {tabs.map((tab) => (
              <div key={tab.id} className={`group flex items-center gap-2 rounded-2xl border px-3 py-2 transition ${tab.id === activeTab?.id ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-800 dark:text-cyan-200" : "border-slate-200/70 bg-white/60 text-slate-600 dark:border-slate-700/70 dark:bg-slate-950/35 dark:text-slate-300"}`}>
                {renamingTabId === tab.id ? (
                  <input value={tab.name} onChange={(event) => updateTab(tab.id, (current) => ({ ...current, name: event.target.value }))} onBlur={() => setRenamingTabId(null)} className="min-w-[7rem] bg-transparent text-sm font-semibold outline-none" />
                ) : (
                  <button type="button" onClick={() => setActiveTabId(tab.id)} onDoubleClick={() => setRenamingTabId(tab.id)} className="text-sm font-semibold">{tab.name}</button>
                )}
                <button type="button" onClick={() => setRenamingTabId(tab.id)} className="opacity-0 transition group-hover:opacity-100" aria-label="Rename tab">
                  <PencilLine className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => removeTab(tab.id)} disabled={tabs.length === 1} className="opacity-0 transition group-hover:opacity-100 disabled:opacity-30" aria-label="Close tab">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button type="button" onClick={addTab} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200/70 bg-white/70 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700/70 dark:bg-slate-950/55 dark:text-slate-200 dark:hover:bg-slate-900">
              <Plus className="h-4 w-4" />
              Add tab
            </button>
          </div>

          {activeTab ? (
            <div className="rounded-[26px] border border-white/25 bg-white/55 p-4 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-slate-950/30">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                  <Code2 className="h-4 w-4 text-cyan-500" />
                  {activeTab.name}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void runTab(activeTab.id)} disabled={activeTab.running} className="inline-flex items-center gap-2 rounded-2xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-55">
                    {activeTab.running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    Run
                  </button>
                  <button type="button" onClick={saveSnippet} className="inline-flex items-center gap-2 rounded-2xl border border-slate-300/70 bg-white/70 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700/70 dark:bg-slate-950/55 dark:text-slate-200 dark:hover:bg-slate-900">
                    <Save className="h-4 w-4" />
                    Save snippet
                  </button>
                  <button type="button" onClick={() => activeTab.rows.length && exportToCSV(activeTab.rows, `${activeTab.name.toLowerCase().replace(/\s+/g, "-")}.csv`)} disabled={!activeTab.rows.length} className="inline-flex items-center gap-2 rounded-2xl border border-slate-300/70 bg-white/70 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-55 dark:border-slate-700/70 dark:bg-slate-950/55 dark:text-slate-200 dark:hover:bg-slate-900">
                    <Download className="h-4 w-4" />
                    Export CSV
                  </button>
                </div>
              </div>

              <div className="relative mt-4">
                <textarea
                  value={activeTab.sql}
                  onChange={(event) => updateTab(activeTab.id, (current) => ({ ...current, sql: event.target.value, cursor: event.target.selectionStart ?? 0 }))}
                  onClick={(event) => updateTab(activeTab.id, (current) => ({ ...current, cursor: event.currentTarget.selectionStart ?? 0 }))}
                  onKeyUp={(event) => updateTab(activeTab.id, (current) => ({ ...current, cursor: event.currentTarget.selectionStart ?? 0 }))}
                  onKeyDown={handleEditorKeyDown}
                  spellCheck={false}
                  className="min-h-[210px] w-full rounded-[22px] border border-slate-200/70 bg-slate-950 px-4 py-4 font-mono text-sm text-slate-100 outline-none transition focus:border-cyan-400"
                />
                {suggestions.length > 0 ? (
                  <div className="absolute left-4 top-4 z-10 w-60 rounded-2xl border border-slate-700/70 bg-slate-950/95 p-2 shadow-xl">
                    {suggestions.map((suggestion) => (
                      <button key={suggestion} type="button" onClick={() => applySuggestion(suggestion)} className="block w-full rounded-xl px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-slate-800">
                        {suggestion}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              {activeTab.error ? (
                <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                  <p className="font-semibold">{activeTab.error}</p>
                  <ul className="mt-2 space-y-1 text-xs">
                    {suggestFixes(activeTab.error, tableName, columns).map((item) => (
                      <li key={item}>• {item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <ResultStat label="Rows" value={formatNumber(activeTab.rowCount)} />
                <ResultStat label="Execution Time" value={activeTab.durationMs == null ? "Not run" : formatDuration(activeTab.durationMs)} />
                <ResultStat label="Typing" value={truncate(deferredSql.replace(/\s+/g, " ").trim() || "Idle", 24)} />
              </div>

              <div className="mt-4 max-h-[320px] overflow-auto rounded-[22px] border border-slate-200/70 bg-white/60 dark:border-slate-700/70 dark:bg-slate-950/35">
                {!activeTab.rows.length ? (
                  <div className="px-5 py-8 text-center text-sm text-slate-500 dark:text-slate-400">Run a query to populate this tab&apos;s results.</div>
                ) : (
                  <table className="min-w-full text-left text-sm">
                    <thead className="sticky top-0 bg-white/90 backdrop-blur dark:bg-slate-950/90">
                      <tr>
                        {activeTab.headers.map((header) => (
                          <th key={header} className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activeTab.rows.map((row, index) => (
                        <tr key={`row-${index}`} className="border-t border-slate-200/60 dark:border-slate-800/70">
                          {activeTab.headers.map((header) => (
                            <td key={`${index}-${header}`} className="px-4 py-3 text-slate-700 dark:text-slate-200">{String(row[header] ?? "")}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-5">
          <div className="rounded-[26px] border border-white/25 bg-white/55 p-5 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-slate-950/30">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              <LibraryBig className="h-4 w-4 text-cyan-500" />
              Snippet library
            </div>
            <div className="mt-4 space-y-3">
              <input value={snippetName} onChange={(event) => setSnippetName(event.target.value)} placeholder="Snippet name" className={fieldClass} />
              <input value={snippetDescription} onChange={(event) => setSnippetDescription(event.target.value)} placeholder="Description" className={fieldClass} />
            </div>
            <div className="mt-4 space-y-3">
              {snippets.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">Save frequently used SQL here with Cmd/Ctrl+S or the save button.</p>
              ) : (
                snippets.map((snippet) => (
                  <div key={snippet.id} className="rounded-2xl border border-slate-200/70 bg-white/65 p-4 dark:border-slate-700/70 dark:bg-slate-950/35">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{snippet.name}</p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{snippet.description}</p>
                      </div>
                      <button type="button" onClick={() => setSnippets(snippets.filter((item) => item.id !== snippet.id))} className="text-slate-400 transition hover:text-rose-500">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button type="button" onClick={() => activeTab && updateTab(activeTab.id, (current) => ({ ...current, sql: snippet.sql, cursor: snippet.sql.length }))} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200/70 bg-white/70 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700/70 dark:bg-slate-950/55 dark:text-slate-200 dark:hover:bg-slate-900">
                        {copiedSnippetId === snippet.id ? <Check className="h-3.5 w-3.5" /> : <Code2 className="h-3.5 w-3.5" />}
                        Load
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-[26px] border border-white/25 bg-white/55 p-5 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-slate-950/30">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              <History className="h-4 w-4 text-cyan-500" />
              Execution history
            </div>
            <div className="mt-4 space-y-3">
              {historyPreview.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">Recent runs are stored in session storage for this browser tab.</p>
              ) : (
                historyPreview.map((entry) => (
                  <button key={entry.id} type="button" onClick={() => activeTab && updateTab(activeTab.id, (current) => ({ ...current, sql: entry.sql, cursor: entry.sql.length }))} className="block w-full rounded-2xl border border-slate-200/70 bg-white/65 p-4 text-left transition hover:border-cyan-400/30 dark:border-slate-700/70 dark:bg-slate-950/35">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{entry.tabName}</p>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{formatRelativeTime(entry.timestamp)}</span>
                    </div>
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{truncate(entry.sql.replace(/\s+/g, " "), 90)}</p>
                    <div className="mt-3 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                      <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{entry.error ? "failed" : formatDuration(entry.durationMs)}</span>
                      <span>{formatNumber(entry.rowCount)} rows</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
