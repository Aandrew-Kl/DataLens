"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { useMemo, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Download,
  Eraser,
  Filter,
  GitCompareArrows,
  ListRestart,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber, generateId } from "@/lib/utils/formatters";

type OperationType = "filter" | "sort" | "transform" | "clean";
type EntryStatus = "active" | "undone" | "failed";

export interface DataChangelogEntry {
  id: string;
  timestamp: number;
  operation: OperationType;
  description: string;
  rowsBefore: number;
  rowsAfter: number;
  rowsAffected: number;
  undoSql?: string;
  status: EntryStatus;
}

interface DataChangelogProps {
  tableName: string;
}

type Notice = {
  tone: "success" | "error" | "info";
  message: string;
} | null;

interface EntryFormState {
  operation: OperationType;
  description: string;
  rowsBefore: string;
  rowsAfter: string;
  undoSql: string;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const listeners = new Set<() => void>();
const defaultForm: EntryFormState = {
  operation: "transform",
  description: "",
  rowsBefore: "",
  rowsAfter: "",
  undoSql: "",
};

const operationMeta: Record<
  OperationType,
  {
    icon: typeof Filter;
    label: string;
    chip: string;
    accent: string;
  }
> = {
  filter: {
    icon: Filter,
    label: "Filter",
    chip: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
    accent: "from-cyan-500/15 to-transparent",
  },
  sort: {
    icon: SlidersHorizontal,
    label: "Sort",
    chip: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
    accent: "from-sky-500/15 to-transparent",
  },
  transform: {
    icon: WandSparkles,
    label: "Transform",
    chip: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    accent: "from-amber-500/15 to-transparent",
  },
  clean: {
    icon: Sparkles,
    label: "Clean",
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    accent: "from-emerald-500/15 to-transparent",
  },
};

function changelogKey(tableName: string) {
  return `datalens:changelog:${tableName}`;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitChange() {
  listeners.forEach((listener) => listener());
}
function readEntries(tableName: string): DataChangelogEntry[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.sessionStorage.getItem(changelogKey(tableName));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DataChangelogEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeEntries(tableName: string, entries: DataChangelogEntry[]) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(changelogKey(tableName), JSON.stringify(entries));
  emitChange();
}

export function appendDataChangelogEntry(
  tableName: string,
  entry: Omit<DataChangelogEntry, "id" | "timestamp" | "rowsAffected" | "status">,
) {
  const normalized: DataChangelogEntry = {
    ...entry,
    id: generateId(),
    timestamp: Date.now(),
    rowsAffected: Math.abs(entry.rowsAfter - entry.rowsBefore),
    status: "active",
  };
  writeEntries(tableName, [normalized, ...readEntries(tableName)]);
}

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildTextExport(tableName: string, entries: DataChangelogEntry[]) {
  return [
    `Changelog for ${tableName}`,
    "",
    ...entries.map((entry) => {
      const meta = operationMeta[entry.operation];
      return [
        `[${formatTimestamp(entry.timestamp)}] ${meta.label} (${entry.status})`,
        entry.description,
        `Rows: ${entry.rowsBefore.toLocaleString()} -> ${entry.rowsAfter.toLocaleString()} (${entry.rowsAffected.toLocaleString()} affected)`,
        entry.undoSql ? `Undo SQL: ${entry.undoSql}` : "Undo SQL: not recorded",
        "",
      ].join("\n");
    }),
  ].join("\n");
}

function DeltaBar({ before, after }: { before: number; after: number }) {
  const maxValue = Math.max(before, after, 1);
  const beforeWidth = `${(before / maxValue) * 100}%`;
  const afterWidth = `${(after / maxValue) * 100}%`;
  const delta = after - before;
  const deltaLabel = delta === 0 ? "No row delta" : `${delta > 0 ? "+" : ""}${formatNumber(delta)}`;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
        <span>Before / After</span>
        <span>{deltaLabel}</span>
      </div>
      <div className="space-y-2">
        <div className="overflow-hidden rounded-full bg-white/60 dark:bg-slate-900/80">
          <div className="h-2 rounded-full bg-slate-300 dark:bg-slate-700" style={{ width: beforeWidth }} />
        </div>
        <div className="overflow-hidden rounded-full bg-white/60 dark:bg-slate-900/80">
          <div className="h-2 rounded-full bg-cyan-500/80" style={{ width: afterWidth }} />
        </div>
      </div>
    </div>
  );
}

function NoticeBanner({ notice }: { notice: Notice }) {
  if (!notice) return null;
  const toneClass =
    notice.tone === "error"
      ? "border-rose-400/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"
      : notice.tone === "success"
        ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
        : "border-cyan-400/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300";

  return <div className={`rounded-2xl border px-4 py-3 text-sm ${toneClass}`}>{notice.message}</div>;
}

export default function DataChangelog({ tableName }: DataChangelogProps) {
  const entries = useSyncExternalStore(subscribe, () => readEntries(tableName), () => []);
  const [form, setForm] = useState<EntryFormState>(defaultForm);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const summary = useMemo(() => {
    return entries.reduce(
      (acc, entry) => {
        acc.total += 1;
        acc.affected += entry.rowsAffected;
        if (entry.status === "undone") acc.undone += 1;
        return acc;
      },
      { total: 0, affected: 0, undone: 0 },
    );
  }, [entries]);

  function updateForm<K extends keyof EntryFormState>(key: K, value: EntryFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleRecordEntry() {
    const description = form.description.trim();
    const rowsBefore = Number(form.rowsBefore);
    const rowsAfter = Number(form.rowsAfter);

    if (!description) {
      setNotice({ tone: "error", message: "Describe the data change before recording it." });
      return;
    }

    if (!Number.isFinite(rowsBefore) || !Number.isFinite(rowsAfter)) {
      setNotice({ tone: "error", message: "Row counts must be numeric so the diff can be rendered." });
      return;
    }

    appendDataChangelogEntry(tableName, {
      operation: form.operation,
      description,
      rowsBefore,
      rowsAfter,
      undoSql: form.undoSql.trim() || undefined,
    });
    setForm(defaultForm);
    setNotice({ tone: "success", message: "Change recorded in session storage for this table." });
  }

  async function handleUndo(entry: DataChangelogEntry) {
    if (entry.status === "undone") return;
    if (!entry.undoSql) {
      setNotice({ tone: "info", message: "This entry does not have undo SQL recorded yet." });
      return;
    }

    setBusyId(entry.id);
    setNotice(null);
    try {
      await runQuery(entry.undoSql);
      const countRows = await runQuery(`SELECT COUNT(*) AS cnt FROM ${quoteIdentifier(tableName)}`);
      const currentRows = Number(countRows[0]?.cnt ?? entry.rowsBefore);
      const updatedEntries = readEntries(tableName).map((current) =>
        current.id === entry.id ? { ...current, status: "undone" as const } : current,
      );

      const revertEntry: DataChangelogEntry = {
        id: generateId(),
        timestamp: Date.now(),
        operation: "transform",
        description: `Undo: ${entry.description}`,
        rowsBefore: entry.rowsAfter,
        rowsAfter: currentRows,
        rowsAffected: Math.abs(entry.rowsAfter - currentRows),
        status: "active",
      };

      writeEntries(tableName, [revertEntry, ...updatedEntries]);
      setNotice({ tone: "success", message: "Undo SQL executed and the timeline was updated." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Undo failed.";
      const failedEntries = readEntries(tableName).map((current) =>
        current.id === entry.id ? { ...current, status: "failed" as const } : current,
      );
      writeEntries(tableName, failedEntries);
      setNotice({ tone: "error", message });
    } finally {
      setBusyId(null);
    }
  }

  function handleExport(kind: "text" | "json") {
    if (entries.length === 0) {
      setNotice({ tone: "info", message: "Record at least one transformation before exporting the changelog." });
      return;
    }

    if (kind === "text") {
      downloadFile(buildTextExport(tableName, entries), `${tableName}-changelog.txt`, "text/plain;charset=utf-8");
    } else {
      downloadFile(JSON.stringify(entries, null, 2), `${tableName}-changelog.json`, "application/json;charset=utf-8");
    }
  }

  function clearEntries() {
    writeEntries(tableName, []);
    setNotice({ tone: "success", message: "Session changelog cleared for this table." });
  }

  return (
    <section className="overflow-hidden rounded-[2rem] border border-white/20 bg-white/60 shadow-2xl shadow-slate-950/10 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45">
      <div className="border-b border-white/15 bg-gradient-to-br from-white/35 to-slate-200/10 px-5 py-5 dark:from-white/10 dark:to-slate-900/10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
                <ListRestart className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">Data Changelog</p>
                <h2 className="mt-1 text-xl font-semibold text-slate-950 dark:text-slate-50">{tableName}</h2>
              </div>
            </div>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Track filters, sorts, cleaning passes, and transformations with row deltas plus per-entry undo SQL.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/20 bg-white/45 px-4 py-3 dark:bg-slate-900/55">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Entries</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-slate-50">{summary.total}</p>
            </div>
            <div className="rounded-2xl border border-white/20 bg-white/45 px-4 py-3 dark:bg-slate-900/55">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Rows Affected</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-slate-50">{formatNumber(summary.affected)}</p>
            </div>
            <div className="rounded-2xl border border-white/20 bg-white/45 px-4 py-3 dark:bg-slate-900/55">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Undone</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-slate-50">{summary.undone}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-5 px-5 py-5">
        <NoticeBanner notice={notice} />

        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }} className="grid gap-4 rounded-[1.75rem] border border-white/15 bg-white/50 p-4 dark:bg-slate-900/40 lg:grid-cols-[1.4fr_0.9fr]">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Record transformation</h3>
            <input value={form.description} onChange={(event) => updateForm("description", event.target.value)} placeholder="Removed test rows older than 2022" className="w-full rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-950 outline-none placeholder:text-slate-400 dark:bg-slate-950/60 dark:text-slate-50" />
            <div className="grid gap-3 sm:grid-cols-3">
              <select value={form.operation} onChange={(event) => updateForm("operation", event.target.value as OperationType)} className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/60 dark:text-slate-50">
                {Object.entries(operationMeta).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
              </select>
              <input value={form.rowsBefore} onChange={(event) => updateForm("rowsBefore", event.target.value)} placeholder="Rows before" className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/60 dark:text-slate-50" />
              <input value={form.rowsAfter} onChange={(event) => updateForm("rowsAfter", event.target.value)} placeholder="Rows after" className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/60 dark:text-slate-50" />
            </div>
            <textarea value={form.undoSql} onChange={(event) => updateForm("undoSql", event.target.value)} rows={3} placeholder='Optional undo SQL, e.g. CREATE OR REPLACE TABLE "sales" AS SELECT * FROM "__snapshot_before_clean"' className="w-full rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-950 outline-none placeholder:text-slate-400 dark:bg-slate-950/60 dark:text-slate-50" />
          </div>

          <div className="flex flex-col justify-between gap-4 rounded-[1.5rem] border border-white/15 bg-slate-950/5 p-4 dark:bg-white/5">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Export & reset</h3>
              <div className="grid gap-2">
                <button type="button" onClick={handleRecordEntry} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500">
                  <GitCompareArrows className="h-4 w-4" />
                  Save entry
                </button>
                <button type="button" onClick={() => handleExport("text")} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/20 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-white/40 dark:text-slate-200">
                  <Download className="h-4 w-4" />
                  Export text
                </button>
                <button type="button" onClick={() => handleExport("json")} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/20 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-white/40 dark:text-slate-200">
                  <Download className="h-4 w-4" />
                  Export JSON
                </button>
                <button type="button" onClick={clearEntries} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-300/40 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-700 transition hover:bg-rose-500/15 dark:text-rose-300">
                  <Eraser className="h-4 w-4" />
                  Clear session log
                </button>
              </div>
            </div>
            <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
              Entries are stored in <span className="font-mono">sessionStorage</span>, so they persist for this browser tab and dataset session.
            </p>
          </div>
        </motion.div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Timeline</h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">{entries.length === 0 ? "No changes yet" : `${entries.length} recorded`}</span>
          </div>

          <AnimatePresence initial={false}>
            {entries.length === 0 ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-[1.75rem] border border-dashed border-white/20 bg-white/35 px-6 py-10 text-center text-sm text-slate-500 dark:bg-slate-900/30 dark:text-slate-400">
                Record the first transformation to start building a timeline for <span className="font-mono">{tableName}</span>.
              </motion.div>
            ) : (
              entries.map((entry, index) => {
                const meta = operationMeta[entry.operation];
                const Icon = meta.icon;
                return (
                  <motion.article key={entry.id} layout initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} transition={{ duration: 0.28, delay: index * 0.03, ease: EASE }} className="overflow-hidden rounded-[1.75rem] border border-white/15 bg-gradient-to-br px-5 py-5 shadow-lg shadow-slate-950/5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/35">
                    <div className={`absolute inset-0 -z-10 bg-gradient-to-br ${meta.accent}`} />
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 dark:text-slate-200">
                            <Icon className="h-3.5 w-3.5" />
                            {formatTimestamp(entry.timestamp)}
                          </span>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${meta.chip}`}>{meta.label}</span>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${entry.status === "failed" ? "bg-rose-500/10 text-rose-700 dark:text-rose-300" : entry.status === "undone" ? "bg-slate-500/10 text-slate-700 dark:text-slate-300" : "bg-white/50 text-slate-600 dark:bg-white/5 dark:text-slate-300"}`}>{entry.status}</span>
                        </div>
                        <h4 className="text-lg font-semibold text-slate-950 dark:text-slate-50">{entry.description}</h4>
                        <div className="flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                          <span className="rounded-full bg-white/50 px-2.5 py-1 dark:bg-slate-900/60">{formatNumber(entry.rowsBefore)} before</span>
                          <span className="rounded-full bg-white/50 px-2.5 py-1 dark:bg-slate-900/60">{formatNumber(entry.rowsAfter)} after</span>
                          <span className="rounded-full bg-white/50 px-2.5 py-1 dark:bg-slate-900/60">{formatNumber(entry.rowsAffected)} affected</span>
                        </div>
                      </div>

                      <button type="button" onClick={() => void handleUndo(entry)} disabled={busyId === entry.id || entry.status === "undone"} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/20 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-white/40 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200">
                        <RotateCcw className={`h-4 w-4 ${busyId === entry.id ? "animate-spin" : ""}`} />
                        Undo
                      </button>
                    </div>

                    <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_0.8fr]">
                      <DeltaBar before={entry.rowsBefore} after={entry.rowsAfter} />
                      <div className="rounded-2xl border border-white/15 bg-white/45 px-4 py-3 text-sm text-slate-600 dark:bg-slate-900/55 dark:text-slate-300">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Undo strategy</p>
                        <p className="mt-2 break-all font-mono text-xs leading-5">{entry.undoSql ?? "No undo SQL captured for this entry."}</p>
                      </div>
                    </div>
                  </motion.article>
                );
              })
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
