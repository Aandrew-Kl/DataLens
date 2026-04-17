"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { startTransition, useMemo, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpDown,
  Database,
  Download,
  Eye,
  FileSearch,
  Import,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  Tag,
  Trash2,
} from "lucide-react";
import { dropTable, runQuery } from "@/lib/duckdb/client";
import { profileTable } from "@/lib/duckdb/profiler";
import { exportToCSV } from "@/lib/utils/export";
import { formatBytes, formatNumber } from "@/lib/utils/formatters";
import { useDatasetStore } from "@/stores/dataset-store";
import type { ColumnProfile, DatasetMeta } from "@/types/dataset";

interface CatalogColumn {
  name: string;
  type: string;
}

interface CatalogItem {
  name: string;
  rowCount: number;
  columnCount: number;
  estimatedSizeBytes: number;
  loadedAt: number | null;
  columns: CatalogColumn[];
}

interface CatalogSnapshot {
  status: "idle" | "loading" | "ready" | "error";
  items: CatalogItem[];
  error: string | null;
  refreshedAt: number | null;
}

interface JoinSuggestion {
  leftColumn: string;
  rightColumn: string;
  score: number;
}

interface JoinDraft {
  leftTable: string;
  rightTable: string;
  leftColumn: string;
  rightColumn: string;
  joinType: "INNER JOIN" | "LEFT JOIN" | "FULL OUTER JOIN";
  joinName: string;
  suggestions: JoinSuggestion[];
}

type SortMode = "name" | "size" | "date_loaded";

const EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_CLASS =
  "rounded-[1.75rem] border border-white/20 bg-white/75 shadow-xl shadow-slate-950/10 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const FIELD_CLASS =
  "rounded-2xl border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-cyan-400 dark:bg-slate-950/45 dark:text-slate-100";
const TAGS_STORAGE_KEY = "datalens:data-catalog:tags";
const catalogListeners = new Set<() => void>();
const tagListeners = new Set<() => void>();
const EMPTY_TAG_MAP: Record<string, string[]> = {};
let cachedTagMap: { raw: string | null; parsed: Record<string, string[]> } = {
  raw: null,
  parsed: EMPTY_TAG_MAP,
};

let catalogSnapshot: CatalogSnapshot = {
  status: "idle",
  items: [],
  error: null,
  refreshedAt: null,
};
function escapeLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function estimateCellSize(type: string) {
  const normalized = type.toUpperCase();
  if (normalized.includes("INT") || normalized.includes("DECIMAL") || normalized.includes("DOUBLE") || normalized.includes("FLOAT")) return 8;
  if (normalized.includes("BOOL")) return 1;
  if (normalized.includes("DATE") || normalized.includes("TIME")) return 8;
  return 24;
}

function estimateTableSize(rowCount: number, columns: CatalogColumn[], sizeBytes: number | null) {
  if (sizeBytes != null && sizeBytes > 0) return sizeBytes;
  const perRow = columns.reduce((sum, column) => sum + estimateCellSize(column.type), 0);
  return Math.max(0, rowCount * Math.max(perRow, 16));
}

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function sanitizeRelationName(value: string) {
  const sanitized = normalizeName(value).slice(0, 63);
  return sanitized || "joined_view";
}

function buildJoinSuggestions(leftColumns: CatalogColumn[], rightColumns: CatalogColumn[]) {
  const suggestions: JoinSuggestion[] = [];

  for (const leftColumn of leftColumns) {
    const leftKey = normalizeName(leftColumn.name);
    for (const rightColumn of rightColumns) {
      const rightKey = normalizeName(rightColumn.name);
      let score = 0;
      if (leftKey === rightKey) score += 100;
      if (leftKey.includes(rightKey) || rightKey.includes(leftKey)) score += 24;
      if (leftColumn.type === rightColumn.type) score += 16;
      if (leftKey.endsWith("_id") && rightKey.endsWith("_id")) score += 16;
      if (score >= 24) {
        suggestions.push({
          leftColumn: leftColumn.name,
          rightColumn: rightColumn.name,
          score,
        });
      }
    }
  }

  return suggestions.sort((left, right) => right.score - left.score).slice(0, 8);
}

function readTagMap() {
  if (typeof window === "undefined") return EMPTY_TAG_MAP;
  try {
    const raw = window.localStorage.getItem(TAGS_STORAGE_KEY);
    if (cachedTagMap.raw === raw) {
      return cachedTagMap.parsed;
    }
    const parsed = raw ? (JSON.parse(raw) as Record<string, string[]>) : EMPTY_TAG_MAP;
    cachedTagMap = { raw, parsed };
    return parsed;
  } catch {
    cachedTagMap = { raw: null, parsed: EMPTY_TAG_MAP };
    return EMPTY_TAG_MAP;
  }
}

function writeTagMap(nextMap: Record<string, string[]>) {
  if (typeof window === "undefined") return;
  const raw = JSON.stringify(nextMap);
  window.localStorage.setItem(TAGS_STORAGE_KEY, raw);
  cachedTagMap = { raw, parsed: nextMap };
  tagListeners.forEach((listener) => listener());
}

function subscribeTags(listener: () => void) {
  tagListeners.add(listener);
  if (typeof window === "undefined") {
    return () => tagListeners.delete(listener);
  }

  function handleStorage(event: StorageEvent) {
    if (event.key === TAGS_STORAGE_KEY) listener();
  }

  window.addEventListener("storage", handleStorage);
  return () => {
    tagListeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

function emitCatalogChange() {
  catalogListeners.forEach((listener) => listener());
}

function subscribeCatalog(listener: () => void) {
  catalogListeners.add(listener);
  return () => catalogListeners.delete(listener);
}

async function buildCatalogItem(tableName: string, datasetMeta: DatasetMeta | undefined) {
  const [countRow, columnRows] = await Promise.all([
    runQuery(`SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(tableName)}`),
    runQuery(`
      SELECT
        column_name,
        data_type
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = ${escapeLiteral(tableName)}
      ORDER BY ordinal_position
    `),
  ]);

  const columns = columnRows.map((row) => ({
    name: String(row.column_name ?? ""),
    type: String(row.data_type ?? "UNKNOWN"),
  }));
  const rowCount = Number(countRow[0]?.row_count ?? 0);

  return {
    name: tableName,
    rowCount,
    columnCount: columns.length,
    estimatedSizeBytes: estimateTableSize(rowCount, columns, datasetMeta?.sizeBytes ?? null),
    loadedAt: datasetMeta?.uploadedAt ?? null,
    columns,
  } satisfies CatalogItem;
}

async function refreshCatalog() {
  catalogSnapshot = {
    ...catalogSnapshot,
    status: "loading",
    error: null,
  };
  emitCatalogChange();

  try {
    const datasetsByName = new Map(
      useDatasetStore.getState().datasets.map((dataset) => [dataset.name, dataset]),
    );
    const tableRows = await runQuery(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    const items = await Promise.all(
      tableRows.map((row) => buildCatalogItem(String(row.table_name ?? ""), datasetsByName.get(String(row.table_name ?? "")))),
    );

    catalogSnapshot = {
      status: "ready",
      items,
      error: null,
      refreshedAt: Date.now(),
    };
  } catch (refreshError) {
    catalogSnapshot = {
      status: "error",
      items: catalogSnapshot.items,
      error: refreshError instanceof Error ? refreshError.message : "Failed to load DuckDB catalog.",
      refreshedAt: Date.now(),
    };
  }

  emitCatalogChange();
}

if (typeof window !== "undefined") {
  void refreshCatalog();
  useDatasetStore.subscribe((state, previous) => {
    if (state.datasets !== previous.datasets) {
      void refreshCatalog();
    }
  });
}

function CatalogTableCard({
  item,
  tags,
  draggingTable,
  onDragStart,
  onDropTable,
  onPreview,
  onProfile,
  onExport,
  onDelete,
  onAddTag,
  tagValue,
  onTagInputChange,
}: {
  item: CatalogItem;
  tags: string[];
  draggingTable: string | null;
  onDragStart: (tableName: string) => void;
  onDropTable: (tableName: string) => void;
  onPreview: (tableName: string) => void;
  onProfile: (tableName: string) => void;
  onExport: (tableName: string) => void;
  onDelete: (tableName: string) => void;
  onAddTag: (tableName: string) => void;
  tagValue: string;
  onTagInputChange: (tableName: string, value: string) => void;
}) {
  const isDropTarget = draggingTable != null && draggingTable !== item.name;

  return (
    <motion.article
      layout
      draggable
      onDragStart={() => onDragStart(item.name)}
      onDragOver={(event) => {
        if (draggingTable && draggingTable !== item.name) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDropTable(item.name);
      }}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: EASE }}
      className={`rounded-[1.5rem] border p-4 transition ${isDropTarget ? "border-cyan-400/40 bg-cyan-500/8" : "border-white/15 bg-white/70 dark:bg-slate-950/45"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-slate-900/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600 dark:bg-white/5 dark:text-slate-300">
            <Database className="h-3.5 w-3.5" />
            {item.name}
          </div>
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
            {formatNumber(item.rowCount)} rows • {formatNumber(item.columnCount)} columns • {formatBytes(item.estimatedSizeBytes)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {item.loadedAt ? `Loaded ${new Date(item.loadedAt).toLocaleString()}` : "Loaded in the current DuckDB session"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onPreview(item.name)} className="rounded-xl border border-white/20 bg-white/80 p-2 text-slate-700 transition hover:bg-white dark:bg-slate-950/45 dark:text-slate-200">
            <Eye className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => onProfile(item.name)} className="rounded-xl border border-white/20 bg-white/80 p-2 text-slate-700 transition hover:bg-white dark:bg-slate-950/45 dark:text-slate-200">
            <FileSearch className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => onExport(item.name)} className="rounded-xl border border-white/20 bg-white/80 p-2 text-slate-700 transition hover:bg-white dark:bg-slate-950/45 dark:text-slate-200">
            <Download className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => onDelete(item.name)} className="rounded-xl border border-rose-300/50 bg-rose-500/10 p-2 text-rose-700 transition hover:bg-rose-500/20 dark:border-rose-500/30 dark:text-rose-300">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {tags.length === 0 ? (
          <span className="rounded-full border border-dashed border-white/20 px-3 py-1 text-xs text-slate-500 dark:text-slate-400">
            No tags yet
          </span>
        ) : (
          tags.map((tag) => (
            <span key={tag} className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-700 dark:text-cyan-300">
              <Tag className="h-3.5 w-3.5" />
              {tag}
            </span>
          ))
        )}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto]">
        <input
          value={tagValue}
          onChange={(event) => onTagInputChange(item.name, event.target.value)}
          placeholder="Add a tag"
          className={FIELD_CLASS}
        />
        <button
          type="button"
          onClick={() => onAddTag(item.name)}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/80 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-white dark:bg-slate-950/45 dark:text-slate-200 dark:hover:bg-slate-950/65"
        >
          <Tag className="h-4 w-4" />
          Save tag
        </button>
      </div>
    </motion.article>
  );
}

export default function DataCatalog() {
  const datasets = useDatasetStore((state) => state.datasets);
  const removeDataset = useDatasetStore((state) => state.removeDataset);
  const snapshot = useSyncExternalStore(
    subscribeCatalog,
    () => catalogSnapshot,
    () => catalogSnapshot,
  );
  const tagMap = useSyncExternalStore(
    subscribeTags,
    readTagMap,
    readTagMap,
  );

  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [draggingTable, setDraggingTable] = useState<string | null>(null);
  const [tagInputs, setTagInputs] = useState<Record<string, string>>({});
  const [previewState, setPreviewState] = useState<{ tableName: string; rows: Record<string, unknown>[] } | null>(null);
  const [profileState, setProfileState] = useState<{ tableName: string; columns: ColumnProfile[] } | null>(null);
  const [joinDraft, setJoinDraft] = useState<JoinDraft | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const catalogItems = useMemo(
    () =>
      snapshot.items.map((item) => ({
        ...item,
        tags: tagMap[item.name] ?? [],
      })),
    [snapshot.items, tagMap],
  );
  const filteredItems = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const next = catalogItems.filter((item) => {
      if (!normalizedSearch) return true;
      return (
        item.name.toLowerCase().includes(normalizedSearch)
        || item.columns.some((column) => column.name.toLowerCase().includes(normalizedSearch))
        || item.tags.some((tag) => tag.toLowerCase().includes(normalizedSearch))
      );
    });

    next.sort((left, right) => {
      if (sortMode === "size") return right.estimatedSizeBytes - left.estimatedSizeBytes;
      if (sortMode === "date_loaded") return (right.loadedAt ?? 0) - (left.loadedAt ?? 0);
      return left.name.localeCompare(right.name);
    });
    return next;
  }, [catalogItems, search, sortMode]);

  function updateTagInput(tableName: string, value: string) {
    setTagInputs((current) => ({
      ...current,
      [tableName]: value,
    }));
  }

  function addTag(tableName: string) {
    const tag = tagInputs[tableName]?.trim();
    if (!tag) return;
    const nextMap = {
      ...tagMap,
      [tableName]: Array.from(new Set([...(tagMap[tableName] ?? []), tag])),
    };
    writeTagMap(nextMap);
    setTagInputs((current) => ({
      ...current,
      [tableName]: "",
    }));
  }

  async function previewTable(tableName: string) {
    setBusyLabel(`preview:${tableName}`);
    setError(null);
    try {
      const rows = await runQuery(`SELECT * FROM ${quoteIdentifier(tableName)} LIMIT 10`);
      startTransition(() => {
        setPreviewState({ tableName, rows });
      });
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Failed to preview the selected table.");
    } finally {
      setBusyLabel(null);
    }
  }

  async function profileSelectedTable(tableName: string) {
    setBusyLabel(`profile:${tableName}`);
    setError(null);
    try {
      const columns = await profileTable(tableName);
      startTransition(() => {
        setProfileState({ tableName, columns });
      });
    } catch (profileError) {
      setError(profileError instanceof Error ? profileError.message : "Failed to profile the selected table.");
    } finally {
      setBusyLabel(null);
    }
  }

  async function exportTable(tableName: string) {
    setBusyLabel(`export:${tableName}`);
    setError(null);
    try {
      const rows = await runQuery(`SELECT * FROM ${quoteIdentifier(tableName)}`);
      exportToCSV(rows, `${tableName}.csv`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Failed to export the selected table.");
    } finally {
      setBusyLabel(null);
    }
  }

  async function deleteSelectedTable(tableName: string) {
    setBusyLabel(`delete:${tableName}`);
    setError(null);
    try {
      await dropTable(tableName);
      const dataset = datasets.find((entry) => entry.name === tableName);
      if (dataset) {
        removeDataset(dataset.id);
      }
      if (previewState?.tableName === tableName) setPreviewState(null);
      if (profileState?.tableName === tableName) setProfileState(null);
      await refreshCatalog();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete the selected table.");
    } finally {
      setBusyLabel(null);
    }
  }

  function startDrag(tableName: string) {
    setDraggingTable(tableName);
  }

  function createJoinDraftForTables(targetTable: string) {
    if (!draggingTable || draggingTable === targetTable) return;
    const leftItem = snapshot.items.find((item) => item.name === draggingTable);
    const rightItem = snapshot.items.find((item) => item.name === targetTable);
    setDraggingTable(null);
    if (!leftItem || !rightItem) return;

    const suggestions = buildJoinSuggestions(leftItem.columns, rightItem.columns);
    const defaultSuggestion = suggestions[0];
    setJoinDraft({
      leftTable: leftItem.name,
      rightTable: rightItem.name,
      leftColumn: defaultSuggestion?.leftColumn ?? leftItem.columns[0]?.name ?? "",
      rightColumn: defaultSuggestion?.rightColumn ?? rightItem.columns[0]?.name ?? "",
      joinType: "INNER JOIN",
      joinName: sanitizeRelationName(`${leftItem.name}_${rightItem.name}_join`),
      suggestions,
    });
  }

  async function createJoinView() {
    if (!joinDraft) return;
    setBusyLabel(`join:${joinDraft.joinName}`);
    setError(null);

    try {
      const joinSql = `
        CREATE OR REPLACE TABLE ${quoteIdentifier(joinDraft.joinName)} AS
        SELECT l.*, r.*
        FROM ${quoteIdentifier(joinDraft.leftTable)} AS l
        ${joinDraft.joinType}
        ${quoteIdentifier(joinDraft.rightTable)} AS r
        ON l.${quoteIdentifier(joinDraft.leftColumn)} = r.${quoteIdentifier(joinDraft.rightColumn)}
      `;
      await runQuery(joinSql);
      await refreshCatalog();
      setJoinDraft(null);
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "Failed to create the join view.");
    } finally {
      setBusyLabel(null);
    }
  }

  function triggerImport() {
    window.dispatchEvent(new CustomEvent("datalens:open-import"));
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, ease: EASE }}
      className={`${PANEL_CLASS} overflow-hidden p-6`}
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700 dark:text-cyan-300">
            <Database className="h-4 w-4" />
            Dataset Catalog
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-900 dark:text-slate-100">Browse all DuckDB tables currently loaded into DataLens</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
            Search the in-memory catalog, preview rows, inspect profiles, export datasets, remove stale relations, and drag one table onto another to draft a join.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 dark:bg-slate-950/45">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Loaded tables</p>
            <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{formatNumber(snapshot.items.length)}</p>
          </div>
          <div className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 dark:bg-slate-950/45">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Catalog status</p>
            <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{snapshot.status}</p>
          </div>
          <button
            type="button"
            onClick={() => void refreshCatalog()}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/80 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-white dark:bg-slate-950/45 dark:text-slate-200 dark:hover:bg-slate-950/65"
          >
            <RefreshCw className={`h-4 w-4 ${snapshot.status === "loading" ? "animate-spin" : ""}`} />
            Refresh catalog
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[1fr_240px]">
        <label className="flex items-center gap-3 rounded-2xl border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-700 dark:bg-slate-950/45 dark:text-slate-100">
          <Search className="h-4 w-4 text-cyan-500" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search tables, columns, or tags"
            className="w-full bg-transparent outline-none"
          />
        </label>
        <label className="flex items-center gap-3 rounded-2xl border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-700 dark:bg-slate-950/45 dark:text-slate-100">
          <ArrowUpDown className="h-4 w-4 text-cyan-500" />
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} className="w-full bg-transparent outline-none">
            <option value="name">Sort by name</option>
            <option value="size">Sort by size</option>
            <option value="date_loaded">Sort by date loaded</option>
          </select>
        </label>
      </div>

      {snapshot.error || error ? (
        <div className="mt-5 rounded-2xl border border-rose-300/50 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:text-rose-300">
          {error ?? snapshot.error}
        </div>
      ) : null}

      {snapshot.status === "loading" && snapshot.items.length === 0 ? (
        <div className="mt-6 flex min-h-[220px] items-center justify-center rounded-[1.5rem] border border-dashed border-white/20 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Inspecting DuckDB tables...
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="mt-6 rounded-[1.5rem] border border-dashed border-white/20 px-6 py-14 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/20 bg-white/80 text-slate-400 dark:bg-slate-950/45 dark:text-slate-500">
            <Import className="h-7 w-7" />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-slate-900 dark:text-slate-100">No DuckDB tables available</h3>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Import a CSV, JSON, or sample dataset to populate the registry, then return here to tag, export, or join it.
          </p>
          <button
            type="button"
            onClick={triggerImport}
            className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
          >
            <Import className="h-4 w-4" />
            Import Data
          </button>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 xl:grid-cols-2">
          <AnimatePresence initial={false}>
            {filteredItems.map((item) => (
              <CatalogTableCard
                key={item.name}
                item={item}
                tags={item.tags}
                draggingTable={draggingTable}
                onDragStart={startDrag}
                onDropTable={createJoinDraftForTables}
                onPreview={(tableName) => void previewTable(tableName)}
                onProfile={(tableName) => void profileSelectedTable(tableName)}
                onExport={(tableName) => void exportTable(tableName)}
                onDelete={(tableName) => void deleteSelectedTable(tableName)}
                onAddTag={addTag}
                tagValue={tagInputs[item.name] ?? ""}
                onTagInputChange={updateTagInput}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {joinDraft ? (
        <div className="mt-6 rounded-[1.5rem] border border-cyan-400/20 bg-cyan-500/8 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-700 dark:text-cyan-300">
                <Link2 className="h-3.5 w-3.5" />
                Join draft
              </div>
              <h3 className="mt-3 text-lg font-semibold text-slate-900 dark:text-slate-100">
                {joinDraft.leftTable} + {joinDraft.rightTable}
              </h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Drag-and-drop chose these two tables. Adjust the key pair, then create a reusable DuckDB view.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setJoinDraft(null)}
              className="rounded-2xl border border-white/20 bg-white/80 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white dark:bg-slate-950/45 dark:text-slate-200 dark:hover:bg-slate-950/65"
            >
              Dismiss
            </button>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr_220px_1fr_auto]">
            <select
              value={joinDraft.leftColumn}
              onChange={(event) => setJoinDraft((current) => current ? { ...current, leftColumn: event.target.value } : current)}
              className={FIELD_CLASS}
            >
              {snapshot.items.find((item) => item.name === joinDraft.leftTable)?.columns.map((column) => (
                <option key={`${joinDraft.leftTable}-${column.name}`} value={column.name}>
                  {joinDraft.leftTable}.{column.name}
                </option>
              ))}
            </select>
            <select
              value={joinDraft.rightColumn}
              onChange={(event) => setJoinDraft((current) => current ? { ...current, rightColumn: event.target.value } : current)}
              className={FIELD_CLASS}
            >
              {snapshot.items.find((item) => item.name === joinDraft.rightTable)?.columns.map((column) => (
                <option key={`${joinDraft.rightTable}-${column.name}`} value={column.name}>
                  {joinDraft.rightTable}.{column.name}
                </option>
              ))}
            </select>
            <select
              value={joinDraft.joinType}
              onChange={(event) => setJoinDraft((current) => current ? { ...current, joinType: event.target.value as JoinDraft["joinType"] } : current)}
              className={FIELD_CLASS}
            >
              <option value="INNER JOIN">Inner join</option>
              <option value="LEFT JOIN">Left join</option>
              <option value="FULL OUTER JOIN">Full outer join</option>
            </select>
            <input
              value={joinDraft.joinName}
              onChange={(event) => setJoinDraft((current) => current ? { ...current, joinName: sanitizeRelationName(event.target.value) } : current)}
              className={FIELD_CLASS}
            />
            <button
              type="button"
              onClick={() => void createJoinView()}
              disabled={busyLabel?.startsWith("join:")}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
            >
              {busyLabel?.startsWith("join:") ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Create join view
            </button>
          </div>

          {joinDraft.suggestions.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {joinDraft.suggestions.map((suggestion) => (
                <button
                  key={`${suggestion.leftColumn}:${suggestion.rightColumn}`}
                  type="button"
                  onClick={() => setJoinDraft((current) => current ? { ...current, leftColumn: suggestion.leftColumn, rightColumn: suggestion.rightColumn } : current)}
                  className="rounded-full border border-white/20 bg-white/80 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-white dark:bg-slate-950/45 dark:text-slate-200 dark:hover:bg-slate-950/65"
                >
                  {suggestion.leftColumn} ↔ {suggestion.rightColumn}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-6 grid gap-5 xl:grid-cols-2">
        <div className="rounded-[1.5rem] border border-white/15 bg-white/65 p-4 dark:bg-slate-950/35">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Preview</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Quick look at the first 10 rows of the selected relation.</p>
            </div>
            {busyLabel?.startsWith("preview:") ? <Loader2 className="h-4 w-4 animate-spin text-cyan-500" /> : null}
          </div>

          {!previewState ? (
            <div className="mt-4 rounded-[1.25rem] border border-dashed border-white/20 px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
              Choose Preview on any table card to inspect its first 10 rows.
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{previewState.tableName}</p>
              <div className="overflow-hidden rounded-[1.25rem] border border-white/15">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-white/85 dark:bg-slate-950/70">
                      <tr>
                        {Object.keys(previewState.rows[0] ?? {}).map((header) => (
                          <th key={header} className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10 bg-white/60 dark:bg-slate-950/45">
                      {previewState.rows.map((row, rowIndex) => (
                        <tr key={`${previewState.tableName}-${rowIndex}`}>
                          {Object.keys(previewState.rows[0] ?? {}).map((header) => (
                            <td key={header} className="px-3 py-2 text-slate-700 dark:text-slate-200">
                              {row[header] == null ? "null" : String(row[header])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-[1.5rem] border border-white/15 bg-white/65 p-4 dark:bg-slate-950/35">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Profile</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Column-level metadata pulled through the existing DuckDB profiler.</p>
            </div>
            {busyLabel?.startsWith("profile:") ? <Loader2 className="h-4 w-4 animate-spin text-cyan-500" /> : null}
          </div>

          {!profileState ? (
            <div className="mt-4 rounded-[1.25rem] border border-dashed border-white/20 px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
              Use Profile on any table card to fetch null counts, sample values, and numeric ranges.
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{profileState.tableName}</p>
              <div className="overflow-hidden rounded-[1.25rem] border border-white/15">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-white/85 dark:bg-slate-950/70">
                      <tr>
                        <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Column</th>
                        <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Type</th>
                        <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Nulls</th>
                        <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Unique</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10 bg-white/60 dark:bg-slate-950/45">
                      {profileState.columns.map((column) => (
                        <tr key={column.name}>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{column.name}</td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{column.type}</td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{formatNumber(column.nullCount)}</td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{formatNumber(column.uniqueCount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.section>
  );
}
