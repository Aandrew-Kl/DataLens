"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Clock3,
  Database,
  GitBranch,
  History,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
} from "lucide-react";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber, formatRelativeTime, generateId } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface DataVersioningProps {
  tableName: string;
  columns: ColumnProfile[];
  rowCount: number;
}

interface DiffSummary {
  added: number;
  removed: number;
  modified: number;
  estimated?: boolean;
}

interface VersionRecord {
  id: string;
  tableName: string;
  branch: string;
  name: string;
  description: string;
  storageTable: string;
  createdAt: number;
  rowCount: number;
  baseVersionId: string | null;
  primaryKeyCandidate: string | null;
  columns: Array<Pick<ColumnProfile, "name" | "type">>;
  diffSummary: DiffSummary;
}

interface BranchRecord {
  name: string;
  sourceVersionId: string | null;
  headVersionId: string | null;
  createdAt: number;
}

interface VersionState {
  versions: VersionRecord[];
  branches: BranchRecord[];
  activeBranchByTable: Record<string, string>;
}

const EASE = [0.16, 1, 0.3, 1] as const;
const STORAGE_KEY = "datalens:data-versioning";
const PANEL = "rounded-3xl border border-white/15 bg-white/10 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/45";

function quoteId(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function sanitize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "version";
}

function detectPrimaryKey(columns: ColumnProfile[], rowCount: number): string | null {
  return columns.find((column) => column.nullCount === 0 && column.uniqueCount === rowCount)?.name ?? null;
}

function hashExpression(columns: string[]): string {
  return columns.length
    ? columns.map((column) => `COALESCE(CAST(${quoteId(column)} AS VARCHAR), '∅')`).join(` || '¦' || `)
    : "'row'";
}

async function compareSnapshots(left: VersionRecord, right: VersionRecord): Promise<DiffSummary> {
  const sharedColumns = left.columns.map((column) => column.name).filter((name) => right.columns.some((candidate) => candidate.name === name));
  const key = left.primaryKeyCandidate && right.primaryKeyCandidate && left.primaryKeyCandidate === right.primaryKeyCandidate ? left.primaryKeyCandidate : null;
  const rowHash = hashExpression(sharedColumns.filter((column) => column !== key));

  if (key) {
    const rows = await runQuery(`
      WITH left_rows AS (
        SELECT ${quoteId(key)} AS key_value, md5(${rowHash}) AS row_hash
        FROM ${quoteId(left.storageTable)}
        WHERE ${quoteId(key)} IS NOT NULL
      ),
      right_rows AS (
        SELECT ${quoteId(key)} AS key_value, md5(${rowHash}) AS row_hash
        FROM ${quoteId(right.storageTable)}
        WHERE ${quoteId(key)} IS NOT NULL
      )
      SELECT
        (SELECT COUNT(*) FROM right_rows r LEFT JOIN left_rows l ON r.key_value = l.key_value WHERE l.key_value IS NULL) AS added_count,
        (SELECT COUNT(*) FROM left_rows l LEFT JOIN right_rows r ON l.key_value = r.key_value WHERE r.key_value IS NULL) AS removed_count,
        (SELECT COUNT(*) FROM left_rows l JOIN right_rows r ON l.key_value = r.key_value WHERE l.row_hash <> r.row_hash) AS modified_count
    `);
    return {
      added: Number(rows[0]?.added_count ?? 0),
      removed: Number(rows[0]?.removed_count ?? 0),
      modified: Number(rows[0]?.modified_count ?? 0),
    };
  }

  const rows = await runQuery(`
    WITH left_rows AS (
      SELECT md5(${hashExpression(sharedColumns)}) AS row_hash, COUNT(*) AS row_count
      FROM ${quoteId(left.storageTable)}
      GROUP BY 1
    ),
    right_rows AS (
      SELECT md5(${hashExpression(sharedColumns)}) AS row_hash, COUNT(*) AS row_count
      FROM ${quoteId(right.storageTable)}
      GROUP BY 1
    ),
    delta AS (
      SELECT
        COALESCE(right_rows.row_count, 0) - COALESCE(left_rows.row_count, 0) AS diff
      FROM left_rows
      FULL OUTER JOIN right_rows USING (row_hash)
    )
    SELECT
      SUM(CASE WHEN diff > 0 THEN diff ELSE 0 END) AS added_count,
      SUM(CASE WHEN diff < 0 THEN ABS(diff) ELSE 0 END) AS removed_count
    FROM delta
  `);
  const added = Number(rows[0]?.added_count ?? 0);
  const removed = Number(rows[0]?.removed_count ?? 0);
  return { added, removed, modified: Math.min(added, removed), estimated: true };
}

export default function DataVersioning({ tableName, columns, rowCount }: DataVersioningProps) {
  const [state, setState] = useLocalStorage<VersionState>(STORAGE_KEY, { versions: [], branches: [], activeBranchByTable: {} });
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [compareLeft, setCompareLeft] = useState("");
  const [compareRight, setCompareRight] = useState("");
  const [branchName, setBranchName] = useState("");
  const [branchVersionId, setBranchVersionId] = useState("");
  const [compareSummary, setCompareSummary] = useState<DiffSummary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const activeBranch = state.activeBranchByTable[tableName] ?? "main";
  const branches = useMemo(
    () => [{ name: "main", sourceVersionId: null, headVersionId: state.versions.filter((version) => version.tableName === tableName && version.branch === "main").sort((a, b) => b.createdAt - a.createdAt)[0]?.id ?? null, createdAt: 0 }, ...state.branches.filter((branch) => branch.name !== "main")],
    [state.branches, state.versions, tableName],
  );
  const versions = useMemo(
    () => state.versions.filter((version) => version.tableName === tableName).sort((left, right) => right.createdAt - left.createdAt),
    [state.versions, tableName],
  );

  async function createVersion(nextName: string, nextDescription: string, branch = activeBranch, restoreSourceId: string | null = null) {
    const branchRecord = branches.find((entry) => entry.name === branch);
    const baseVersion = versions.find((version) => version.id === (restoreSourceId ?? branchRecord?.headVersionId ?? null)) ?? null;
    const storageTable = `__version_${sanitize(tableName)}_${sanitize(nextName)}_${Date.now()}`;
    await runQuery(`CREATE TABLE ${quoteId(storageTable)} AS SELECT * FROM ${quoteId(tableName)}`);
    const nextVersion: VersionRecord = {
      id: generateId(),
      tableName,
      branch,
      name: nextName,
      description: nextDescription,
      storageTable,
      createdAt: Date.now(),
      rowCount,
      baseVersionId: baseVersion?.id ?? null,
      primaryKeyCandidate: detectPrimaryKey(columns, rowCount),
      columns: columns.map((column) => ({ name: column.name, type: column.type })),
      diffSummary: baseVersion ? await compareSnapshots(baseVersion, { id: "candidate", tableName, branch, name: nextName, description: nextDescription, storageTable, createdAt: Date.now(), rowCount, baseVersionId: baseVersion.id, primaryKeyCandidate: detectPrimaryKey(columns, rowCount), columns: columns.map((column) => ({ name: column.name, type: column.type })), diffSummary: { added: 0, removed: 0, modified: 0 } }) : { added: rowCount, removed: 0, modified: 0 },
    };
    setState((current) => ({
      versions: [nextVersion, ...current.versions],
      branches: current.branches.map((entry) => entry.name === branch ? { ...entry, headVersionId: nextVersion.id } : entry),
      activeBranchByTable: { ...current.activeBranchByTable, [tableName]: branch },
    }));
  }

  async function handleSnapshot() {
    if (!name.trim()) return setNotice("Enter a version name first.");
    setBusy("snapshot");
    setNotice(null);
    try {
      await createVersion(name.trim(), description.trim());
      setName("");
      setDescription("");
      setNotice("Snapshot created from the current DuckDB table state.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Snapshot creation failed.");
    } finally {
      setBusy(null);
    }
  }

  async function handleCompare() {
    const left = versions.find((version) => version.id === compareLeft);
    const right = versions.find((version) => version.id === compareRight);
    if (!left || !right) return;
    setBusy("compare");
    setNotice(null);
    try {
      setCompareSummary(await compareSnapshots(left, right));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Comparison failed.");
    } finally {
      setBusy(null);
    }
  }

  async function handleRestore(version: VersionRecord) {
    if (!window.confirm(`Restore ${version.name} into ${tableName}? A safety snapshot will be created first.`)) return;
    setBusy(version.id);
    setNotice(null);
    try {
      await createVersion(`auto_before_restore_${Date.now()}`, `Automatic snapshot before restoring ${version.name}`, activeBranch);
      await runQuery(`CREATE OR REPLACE TABLE ${quoteId(tableName)} AS SELECT * FROM ${quoteId(version.storageTable)}`);
      setNotice(`Restored ${version.name} into ${tableName}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Restore failed.");
    } finally {
      setBusy(null);
    }
  }

  async function handleBranchCreate() {
    if (!branchName.trim() || !branchVersionId) return setNotice("Choose a source version and branch name.");
    setState((current) => ({
      versions: current.versions,
      branches: current.branches.some((entry) => entry.name === branchName.trim())
        ? current.branches
        : [...current.branches, { name: branchName.trim(), sourceVersionId: branchVersionId, headVersionId: branchVersionId, createdAt: Date.now() }],
      activeBranchByTable: { ...current.activeBranchByTable, [tableName]: branchName.trim() },
    }));
    setBranchName("");
    setBranchVersionId("");
    setNotice("Branch metadata saved. New snapshots will advance this branch.");
  }

  return (
    <section className="overflow-hidden rounded-[30px] border border-white/15 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.16),transparent_24%),linear-gradient(135deg,rgba(248,250,252,0.92),rgba(226,232,240,0.75))] shadow-[0_30px_120px_-50px_rgba(15,23,42,0.9)] dark:border-white/10 dark:bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.12),transparent_24%),linear-gradient(135deg,rgba(2,6,23,0.95),rgba(15,23,42,0.88))]">
      <div className="border-b border-white/10 px-6 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-700 dark:text-cyan-300">
              <History className="h-3.5 w-3.5" />
              Data Versioning
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">Track snapshots and restore points for {tableName}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">Snapshots are physical DuckDB tables. Metadata, branches, and compare choices live in localStorage.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className={`${PANEL} px-4 py-3`}><div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Active branch</div><div className="mt-2 text-lg font-semibold text-slate-950 dark:text-slate-50">{activeBranch}</div></div>
            <div className={`${PANEL} px-4 py-3`}><div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Versions</div><div className="mt-2 text-lg font-semibold text-slate-950 dark:text-slate-50">{formatNumber(versions.length)}</div></div>
            <div className={`${PANEL} px-4 py-3`}><div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Rows now</div><div className="mt-2 text-lg font-semibold text-slate-950 dark:text-slate-50">{formatNumber(rowCount)}</div></div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 px-6 py-6 xl:grid-cols-[0.92fr_1.08fr]">
        <div className="space-y-5">
          <div className={`${PANEL} p-5`}>
            <div className="mb-4 flex items-center gap-2 text-slate-900 dark:text-slate-100"><Save className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />Create named snapshot</div>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="pre-cleaning baseline" className="w-full rounded-2xl border border-white/15 bg-white/40 px-4 py-3 dark:bg-slate-950/40" />
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="What changed or why this snapshot matters" className="mt-3 w-full rounded-2xl border border-white/15 bg-white/40 px-4 py-3 dark:bg-slate-950/40" />
            <div className="mt-4 flex items-center gap-3">
              <button type="button" onClick={() => void handleSnapshot()} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm font-medium text-cyan-800 disabled:opacity-60 dark:text-cyan-200">
                {busy === "snapshot" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Create snapshot
              </button>
              <div className="text-sm text-slate-500 dark:text-slate-400">Branch: <span className="font-semibold text-slate-800 dark:text-slate-200">{activeBranch}</span></div>
            </div>
          </div>

          <div className={`${PANEL} p-5`}>
            <div className="mb-4 flex items-center gap-2 text-slate-900 dark:text-slate-100"><GitBranch className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />Create branch from version</div>
            <select value={branchVersionId} onChange={(event) => setBranchVersionId(event.target.value)} className="w-full rounded-2xl border border-white/15 bg-white/40 px-4 py-3 dark:bg-slate-950/40">
              <option value="">Select source version</option>
              {versions.map((version) => <option key={version.id} value={version.id}>{version.branch} / {version.name}</option>)}
            </select>
            <input value={branchName} onChange={(event) => setBranchName(event.target.value)} placeholder="experiment_branch" className="mt-3 w-full rounded-2xl border border-white/15 bg-white/40 px-4 py-3 dark:bg-slate-950/40" />
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" onClick={() => void handleBranchCreate()} className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-slate-700 dark:text-slate-200"><GitBranch className="h-4 w-4" />Save branch</button>
              {branches.map((branch) => (
                <button key={branch.name} type="button" onClick={() => setState((current) => ({ ...current, activeBranchByTable: { ...current.activeBranchByTable, [tableName]: branch.name } }))} className={`rounded-2xl border px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] ${activeBranch === branch.name ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-800 dark:text-cyan-200" : "border-white/10 bg-white/5 text-slate-500 dark:text-slate-400"}`}>{branch.name}</button>
              ))}
            </div>
          </div>

          <div className={`${PANEL} p-5`}>
            <div className="mb-4 flex items-center gap-2 text-slate-900 dark:text-slate-100"><RefreshCw className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />Compare two versions</div>
            <div className="grid gap-3 md:grid-cols-2">
              <select value={compareLeft} onChange={(event) => setCompareLeft(event.target.value)} className="rounded-2xl border border-white/15 bg-white/40 px-4 py-3 dark:bg-slate-950/40">
                <option value="">Base version</option>
                {versions.map((version) => <option key={version.id} value={version.id}>{version.name}</option>)}
              </select>
              <select value={compareRight} onChange={(event) => setCompareRight(event.target.value)} className="rounded-2xl border border-white/15 bg-white/40 px-4 py-3 dark:bg-slate-950/40">
                <option value="">Target version</option>
                {versions.map((version) => <option key={version.id} value={version.id}>{version.name}</option>)}
              </select>
            </div>
            <button type="button" onClick={() => void handleCompare()} disabled={busy !== null || !compareLeft || !compareRight} className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-slate-700 disabled:opacity-60 dark:text-slate-200">
              {busy === "compare" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock3 className="h-4 w-4" />}Compare versions
            </button>
            {compareSummary ? <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-600 dark:text-slate-300">Added: <span className="font-semibold text-slate-900 dark:text-slate-100">{formatNumber(compareSummary.added)}</span>, removed: <span className="font-semibold text-slate-900 dark:text-slate-100">{formatNumber(compareSummary.removed)}</span>, modified: <span className="font-semibold text-slate-900 dark:text-slate-100">{formatNumber(compareSummary.modified)}</span>{compareSummary.estimated ? " (estimated without a stable key)" : ""}.</div> : null}
          </div>
        </div>

        <div className={`${PANEL} p-5`}>
          <div className="mb-4 flex items-center gap-2 text-slate-900 dark:text-slate-100"><Database className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />Version history</div>
          <div className="space-y-3">
            <AnimatePresence initial={false}>
              {versions.map((version) => (
                <motion.article key={version.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.22, ease: EASE }} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-white/10 bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{version.branch}</span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">{formatRelativeTime(version.createdAt)}</span>
                      </div>
                      <h3 className="mt-3 text-base font-semibold text-slate-950 dark:text-slate-50">{version.name}</h3>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{version.description || "No description provided."}</p>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span className="rounded-full bg-white/10 px-2.5 py-1">{formatNumber(version.rowCount)} rows</span>
                        <span className="rounded-full bg-white/10 px-2.5 py-1">{version.storageTable}</span>
                        {version.primaryKeyCandidate ? <span className="rounded-full bg-white/10 px-2.5 py-1">PK candidate: {version.primaryKeyCandidate}</span> : null}
                      </div>
                      <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Diff summary: +{formatNumber(version.diffSummary.added)} / -{formatNumber(version.diffSummary.removed)} / ~{formatNumber(version.diffSummary.modified)}{version.diffSummary.estimated ? " estimated" : ""}</p>
                    </div>
                    <button type="button" onClick={() => void handleRestore(version)} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-800 disabled:opacity-60 dark:text-emerald-200">
                      {busy === version.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}Restore
                    </button>
                  </div>
                </motion.article>
              ))}
            </AnimatePresence>
          </div>
          {notice ? <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-800 dark:text-cyan-200">{notice}</div> : null}
        </div>
      </div>
    </section>
  );
}
