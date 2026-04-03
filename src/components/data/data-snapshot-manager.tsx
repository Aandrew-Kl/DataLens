"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Camera, GitCompare, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
} from "@/lib/utils/advanced-analytics";
import { formatNumber, formatRelativeTime, generateId } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface DataSnapshotManagerProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface SnapshotRecord {
  id: string;
  sourceTable: string;
  storageTable: string;
  name: string;
  createdAt: number;
  rowCount: number;
  columnCount: number;
}

interface SnapshotCompare {
  snapshotId: string;
  currentRows: number;
  snapshotRows: number;
  rowDelta: number;
  columnDelta: number;
}

const STORAGE_KEY = "datalens-data-snapshot-manager";

function isSnapshotRecord(value: unknown): value is SnapshotRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as SnapshotRecord).id === "string" &&
    typeof (value as SnapshotRecord).sourceTable === "string" &&
    typeof (value as SnapshotRecord).storageTable === "string" &&
    typeof (value as SnapshotRecord).name === "string" &&
    typeof (value as SnapshotRecord).createdAt === "number" &&
    typeof (value as SnapshotRecord).rowCount === "number" &&
    typeof (value as SnapshotRecord).columnCount === "number"
  );
}

function readSnapshots() {
  if (typeof window === "undefined") return [] as SnapshotRecord[];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isSnapshotRecord) : [];
  } catch {
    return [];
  }
}

function sanitizeSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
}

export default function DataSnapshotManager({
  tableName,
  columns,
}: DataSnapshotManagerProps) {
  const [snapshotName, setSnapshotName] = useState("");
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>(() => readSnapshots());
  const [compareResult, setCompareResult] = useState<SnapshotCompare | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
  }, [snapshots]);

  const tableSnapshots = useMemo(
    () =>
      snapshots
        .filter((snapshot) => snapshot.sourceTable === tableName)
        .sort((left, right) => right.createdAt - left.createdAt),
    [snapshots, tableName],
  );

  async function handleCreateSnapshot() {
    const name = snapshotName.trim() || `${tableName} snapshot`;
    const storageTable = `__snapshot_${sanitizeSegment(tableName)}_${Date.now()}`;

    setBusyAction("create");
    setStatus(null);

    try {
      await runQuery(
        `CREATE TABLE ${quoteIdentifier(storageTable)} AS SELECT * FROM ${quoteIdentifier(tableName)}`,
      );
      const rowResult = await runQuery(
        `SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(storageTable)}`,
      );
      const rowCount = Number(rowResult[0]?.row_count ?? 0);

      setSnapshots((current) => [
        {
          id: generateId(),
          sourceTable: tableName,
          storageTable,
          name,
          createdAt: Date.now(),
          rowCount,
          columnCount: columns.length,
        },
        ...current,
      ]);
      setSnapshotName("");
      setStatus(`Created snapshot ${storageTable}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Snapshot creation failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCompare(snapshot: SnapshotRecord) {
    setBusyAction(`${snapshot.id}:compare`);
    setStatus(null);

    try {
      const currentRowsResult = await runQuery(
        `SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(tableName)}`,
      );
      const snapshotRowsResult = await runQuery(
        `SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(snapshot.storageTable)}`,
      );

      const currentRows = Number(currentRowsResult[0]?.row_count ?? 0);
      const snapshotRows = Number(snapshotRowsResult[0]?.row_count ?? 0);

      setCompareResult({
        snapshotId: snapshot.id,
        currentRows,
        snapshotRows,
        rowDelta: currentRows - snapshotRows,
        columnDelta: columns.length - snapshot.columnCount,
      });
      setStatus(`Compared ${snapshot.name} with the current table.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Snapshot compare failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRestore(snapshot: SnapshotRecord) {
    setBusyAction(`${snapshot.id}:restore`);
    setStatus(null);

    try {
      await runQuery(
        `CREATE OR REPLACE TABLE ${quoteIdentifier(tableName)} AS SELECT * FROM ${quoteIdentifier(snapshot.storageTable)}`,
      );
      setStatus(`Restored ${snapshot.name} into ${tableName}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Snapshot restore failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDelete(snapshot: SnapshotRecord) {
    setBusyAction(`${snapshot.id}:delete`);
    setStatus(null);

    try {
      await runQuery(`DROP TABLE IF EXISTS ${quoteIdentifier(snapshot.storageTable)}`);
      setSnapshots((current) => current.filter((entry) => entry.id !== snapshot.id));
      setCompareResult((current) =>
        current?.snapshotId === snapshot.id ? null : current,
      );
      setStatus(`Deleted ${snapshot.name}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Snapshot deletion failed.");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Camera className="h-6 w-6 text-cyan-600 dark:text-cyan-300" />
            <h2 className="text-xl font-semibold text-slate-950 dark:text-slate-50">
              Manage table snapshots
            </h2>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
            Create physical DuckDB table copies with the <code>__snapshot_</code> prefix, compare
            them against the live table, and restore or delete them when needed.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(18rem,0.9fr)_minmax(0,1.1fr)]">
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Snapshot name
            </span>
            <input
              value={snapshotName}
              onChange={(event) => setSnapshotName(event.target.value)}
              placeholder="Before cleaning"
              className={FIELD_CLASS}
            />
          </label>
          <button
            type="button"
            onClick={() => void handleCreateSnapshot()}
            disabled={busyAction === "create"}
            className={`${BUTTON_CLASS} mt-4 w-full`}
          >
            {busyAction === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            Create snapshot
          </button>

          {status ? (
            <p className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-700 dark:text-cyan-300">
              {status}
            </p>
          ) : null}
        </div>

        <div className="grid gap-4">
          {compareResult ? (
            <div className={`${GLASS_CARD_CLASS} p-4`}>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-slate-50">
                <GitCompare className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                Snapshot comparison
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Current rows</div>
                  <div className="mt-2 text-lg font-semibold text-slate-950 dark:text-slate-50">{formatNumber(compareResult.currentRows)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Snapshot rows</div>
                  <div className="mt-2 text-lg font-semibold text-slate-950 dark:text-slate-50">{formatNumber(compareResult.snapshotRows)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Row delta</div>
                  <div className="mt-2 text-lg font-semibold text-slate-950 dark:text-slate-50">{formatNumber(compareResult.rowDelta)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Column delta</div>
                  <div className="mt-2 text-lg font-semibold text-slate-950 dark:text-slate-50">{formatNumber(compareResult.columnDelta)}</div>
                </div>
              </div>
            </div>
          ) : null}

          <div className="space-y-4">
            {tableSnapshots.length > 0 ? (
              tableSnapshots.map((snapshot) => (
                <motion.div
                  key={snapshot.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: ANALYTICS_EASE }}
                  className={`${GLASS_CARD_CLASS} p-4`}
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-950 dark:text-slate-50">
                        {snapshot.name}
                      </div>
                      <p className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">
                        {snapshot.storageTable}
                      </p>
                      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                        {formatNumber(snapshot.rowCount)} rows • {formatNumber(snapshot.columnCount)} columns •{" "}
                        {formatRelativeTime(snapshot.createdAt)}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void handleCompare(snapshot)}
                        disabled={busyAction !== null}
                        className={BUTTON_CLASS}
                      >
                        {busyAction === `${snapshot.id}:compare` ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitCompare className="h-4 w-4" />}
                        Compare
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRestore(snapshot)}
                        disabled={busyAction !== null}
                        className={BUTTON_CLASS}
                      >
                        {busyAction === `${snapshot.id}:restore` ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                        Restore
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(snapshot)}
                        disabled={busyAction !== null}
                        className={BUTTON_CLASS}
                      >
                        {busyAction === `${snapshot.id}:delete` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        Delete
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))
            ) : (
              <div className={`${GLASS_CARD_CLASS} p-4 text-sm text-slate-600 dark:text-slate-300`}>
                No snapshots recorded yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
