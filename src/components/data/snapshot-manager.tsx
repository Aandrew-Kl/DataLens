"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Camera, CheckCircle2, Database, History, Loader2, RotateCcw, Trash2 } from "lucide-react";
import type { ColumnProfile } from "@/types/dataset";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber, formatRelativeTime, generateId } from "@/lib/utils/formatters";

interface SnapshotManagerProps { tableName: string; columns: ColumnProfile[]; rowCount: number; }
interface SnapshotRecord {
  id: string;
  sourceTable: string;
  name: string;
  storageTable: string;
  createdAt: number;
  rowCount: number;
  columns: Array<Pick<ColumnProfile, "name" | "type">>;
}
type StatusState = { type: "success" | "error"; message: string } | null;

const STORAGE_KEY = "datalens:snapshot-metadata";
const container = "rounded-2xl border border-slate-200/70 bg-white/80 shadow-sm dark:border-slate-800/80 dark:bg-slate-950/55";

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function sanitizeSnapshotName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "snapshot";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : "DuckDB rejected the snapshot operation.";
}

function nextSnapshotTableName(name: string, snapshots: SnapshotRecord[]) {
  const base = `__snapshot_${sanitizeSnapshotName(name)}`;
  const existing = new Set(snapshots.map((snapshot) => snapshot.storageTable));
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

function describeColumns(columns: SnapshotRecord["columns"]) {
  if (!columns.length) return "Schema metadata unavailable";
  const preview = columns.slice(0, 3).map((column) => column.name);
  return columns.length > 3 ? `${preview.join(", ")} +${columns.length - 3}` : preview.join(", ");
}

function SnapshotMetric({ icon: Icon, label, value }: { icon: typeof Database; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 shadow-sm dark:border-slate-800/80 dark:bg-slate-950/50">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        <Icon className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
        {label}
      </div>
      <div className="mt-3 text-xl font-semibold text-slate-950 dark:text-slate-50">{value}</div>
    </div>
  );
}

function SnapshotRow({
  snapshot,
  busyAction,
  onRestore,
  onDelete,
}: {
  snapshot: SnapshotRecord;
  busyAction: string | null;
  onRestore: (snapshot: SnapshotRecord) => Promise<void>;
  onDelete: (snapshot: SnapshotRecord) => Promise<void>;
}) {
  const restoring = busyAction === `${snapshot.id}:restore`;
  const deleting = busyAction === `${snapshot.id}:delete`;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.18 }}
      className={`${container} p-4`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-cyan-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
              Snapshot
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">{formatRelativeTime(snapshot.createdAt)}</span>
          </div>
          <h3 className="mt-3 truncate text-base font-semibold text-slate-950 dark:text-slate-50">{snapshot.name}</h3>
          <p className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">{snapshot.storageTable}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600 dark:text-slate-300">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-900">{formatNumber(snapshot.rowCount)} rows</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-900">{formatNumber(snapshot.columns.length)} columns</span>
          </div>
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{describeColumns(snapshot.columns)}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void onRestore(snapshot)}
            disabled={Boolean(busyAction)}
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-300/60 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-700/60 dark:text-emerald-300"
          >
            {restoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            Restore
          </button>
          <button
            type="button"
            onClick={() => void onDelete(snapshot)}
            disabled={Boolean(busyAction)}
            className="inline-flex items-center gap-2 rounded-xl border border-rose-300/60 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-700/60 dark:text-rose-300"
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Delete
          </button>
        </div>
      </div>
    </motion.li>
  );
}

export default function SnapshotManager({ tableName, columns, rowCount }: SnapshotManagerProps) {
  const [name, setName] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusState>(null);
  const [liveStats, setLiveStats] = useState({ rowCount, columnCount: columns.length });
  const [allSnapshots, setAllSnapshots] = useLocalStorage<SnapshotRecord[]>(STORAGE_KEY, []);

  useEffect(() => {
    setLiveStats({ rowCount, columnCount: columns.length });
  }, [columns.length, rowCount]);

  const tableSnapshots = allSnapshots
    .filter((snapshot) => snapshot.sourceTable === tableName)
    .sort((a, b) => b.createdAt - a.createdAt);

  async function handleCreateSnapshot() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setStatus({ type: "error", message: "Enter a snapshot name first." });
      return;
    }

    setBusyAction("create");
    setStatus(null);
    try {
      const storageTable = nextSnapshotTableName(trimmedName, allSnapshots);
      await runQuery(`CREATE TABLE ${quoteIdentifier(storageTable)} AS SELECT * FROM ${quoteIdentifier(tableName)}`);
      const nextSnapshot: SnapshotRecord = {
        id: generateId(),
        sourceTable: tableName,
        name: trimmedName,
        storageTable,
        createdAt: Date.now(),
        rowCount: liveStats.rowCount,
        columns: columns.map((column) => ({ name: column.name, type: column.type })),
      };
      setAllSnapshots((current) => [nextSnapshot, ...current]);
      setName("");
      setStatus({ type: "success", message: `Created ${storageTable} from ${tableName}.` });
    } catch (error) {
      setStatus({ type: "error", message: getErrorMessage(error) });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRestoreSnapshot(snapshot: SnapshotRecord) {
    if (!window.confirm(`Restore "${snapshot.name}" into "${tableName}"? This replaces the current table contents.`)) return;
    setBusyAction(`${snapshot.id}:restore`);
    setStatus(null);
    try {
      await runQuery(
        `CREATE OR REPLACE TABLE ${quoteIdentifier(tableName)} AS SELECT * FROM ${quoteIdentifier(snapshot.storageTable)}`,
      );
      setLiveStats({ rowCount: snapshot.rowCount, columnCount: snapshot.columns.length });
      setStatus({ type: "success", message: `Restored ${snapshot.name} into ${tableName}.` });
    } catch (error) {
      setStatus({ type: "error", message: getErrorMessage(error) });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDeleteSnapshot(snapshot: SnapshotRecord) {
    if (!window.confirm(`Delete "${snapshot.name}" and drop ${snapshot.storageTable}?`)) return;
    setBusyAction(`${snapshot.id}:delete`);
    setStatus(null);
    try {
      await runQuery(`DROP TABLE IF EXISTS ${quoteIdentifier(snapshot.storageTable)}`);
      setAllSnapshots((current) => current.filter((entry) => entry.id !== snapshot.id));
      setStatus({ type: "success", message: `Deleted ${snapshot.name}.` });
    } catch (error) {
      setStatus({ type: "error", message: getErrorMessage(error) });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200/70 bg-gradient-to-br from-slate-50 via-white to-cyan-50/60 shadow-xl shadow-slate-950/5 dark:border-slate-800/70 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      <div className="border-b border-slate-200/70 px-5 py-5 dark:border-slate-800/80">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
                <Camera className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">Snapshot Manager</p>
                <h2 className="mt-1 text-xl font-semibold text-slate-950 dark:text-slate-50">
                  Save, restore, and prune table snapshots
                </h2>
              </div>
            </div>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Snapshots are physical DuckDB tables named with the{" "}
              <span className="font-mono text-slate-900 dark:text-slate-100">__snapshot_</span>{" "}
              prefix and indexed in localStorage for quick listing.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <SnapshotMetric icon={Database} label="Rows" value={formatNumber(liveStats.rowCount)} />
            <SnapshotMetric icon={History} label="Columns" value={formatNumber(liveStats.columnCount)} />
            <SnapshotMetric icon={Camera} label="Snapshots" value={formatNumber(tableSnapshots.length)} />
          </div>
        </div>
      </div>

      <div className="px-5 py-5">
        <motion.form
          layout
          onSubmit={(event) => {
            event.preventDefault();
            void handleCreateSnapshot();
          }}
          className={`${container} border-slate-200/70 bg-white/70 p-4 dark:bg-slate-950/55`}
        >
          <div className="flex flex-col gap-3 lg:flex-row">
            <label className="flex-1">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Snapshot name
              </span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="pre-cleaning audit"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition-colors placeholder:text-slate-400 focus:border-cyan-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 dark:focus:border-cyan-500"
              />
            </label>
            <button
              type="submit"
              disabled={busyAction !== null}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-cyan-300 dark:text-slate-950 dark:hover:bg-cyan-200 lg:self-end"
            >
              {busyAction === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              Create snapshot
            </button>
          </div>
        </motion.form>

        <AnimatePresence initial={false}>
          {status && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className={`mt-4 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${
                status.type === "success"
                  ? "border-emerald-300/60 bg-emerald-500/10 text-emerald-800 dark:border-emerald-700/60 dark:text-emerald-200"
                  : "border-rose-300/60 bg-rose-500/10 text-rose-800 dark:border-rose-700/60 dark:text-rose-200"
              }`}
            >
              {status.type === "success" ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span>{status.message}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-5">
          <div className="mb-3 flex items-center gap-2">
            <History className="h-4 w-4 text-slate-500 dark:text-slate-400" />
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Available snapshots</h3>
          </div>

          <AnimatePresence mode="popLayout">
            {tableSnapshots.length > 0 ? (
              <motion.ul layout className="space-y-3">
                {tableSnapshots.map((snapshot) => (
                  <SnapshotRow
                    key={snapshot.id}
                    snapshot={snapshot}
                    busyAction={busyAction}
                    onRestore={handleRestoreSnapshot}
                    onDelete={handleDeleteSnapshot}
                  />
                ))}
              </motion.ul>
            ) : (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                className="rounded-2xl border border-dashed border-slate-300/80 bg-white/50 px-5 py-8 text-center dark:border-slate-700/80 dark:bg-slate-950/35"
              >
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                  <AlertCircle className="h-5 w-5" />
                </div>
                <h4 className="mt-4 text-sm font-semibold text-slate-950 dark:text-slate-50">No snapshots for {tableName}</h4>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  Create one before destructive edits so you can restore the full table with a single action.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
