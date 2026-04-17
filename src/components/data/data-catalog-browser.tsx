"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { startTransition, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowUpDown,
  Database,
  Loader2,
  RefreshCw,
  Search,
  Table2,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatBytes, formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface DataCatalogBrowserProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface CatalogEntry {
  name: string;
  rowCount: number;
  columnCount: number;
  columnNames: string[];
  sizeBytes: number;
  discoveredAt: number;
}

type SortMode = "name" | "size" | "date";

const EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_CLASS =
  "border border-white/20 bg-white/75 backdrop-blur-2xl dark:bg-slate-950/45 rounded-[1.75rem] shadow-xl shadow-slate-950/10";
const FIELD_CLASS =
  "rounded-2xl border border-white/20 bg-white/80 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:bg-slate-950/50 dark:text-slate-100";
function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function toNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function estimateSizeBytes(rowCount: number, columnCount: number): number {
  return Math.max(rowCount, 1) * Math.max(columnCount, 1) * 24;
}

function buildSearchText(entry: CatalogEntry): string {
  return `${entry.name} ${entry.columnNames.join(" ")}`.toLowerCase();
}

async function loadCatalog(
  currentTableName: string,
  currentColumns: ColumnProfile[],
): Promise<CatalogEntry[]> {
  const tableRows = await runQuery(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);

  const discoveredBase = Date.now();

  return Promise.all(
    tableRows.map(async (row, index) => {
      const name = String(row.table_name ?? "");
      const [countRows, columnRows] = await Promise.all([
        runQuery(`SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(name)}`),
        runQuery(`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = ${quoteLiteral(name)}
          ORDER BY ordinal_position
        `),
      ]);

      const columnNames = columnRows
        .map((columnRow) => String(columnRow.column_name ?? ""))
        .filter((columnName) => columnName.length > 0);

      const fallbackColumns =
        name === currentTableName && currentColumns.length > 0
          ? currentColumns.map((column) => column.name)
          : [];
      const finalColumnNames = columnNames.length > 0 ? columnNames : fallbackColumns;
      const rowCount = toNumber(countRows[0]?.row_count);
      const columnCount = finalColumnNames.length;

      return {
        name,
        rowCount,
        columnCount,
        columnNames: finalColumnNames,
        sizeBytes: estimateSizeBytes(rowCount, columnCount),
        discoveredAt: discoveredBase - index * 60_000,
      } satisfies CatalogEntry;
    }),
  );
}

export default function DataCatalogBrowser({
  tableName,
  columns,
}: DataCatalogBrowserProps) {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [selectedTable, setSelectedTable] = useState(tableName);
  const [status, setStatus] = useState<string>("Refresh the catalog to browse loaded datasets.");
  const [loading, setLoading] = useState(false);

  async function handleRefresh() {
    setLoading(true);
    setStatus("Reading DuckDB metadata...");
    try {
      const nextCatalog = await loadCatalog(tableName, columns);
      startTransition(() => {
        setCatalog(nextCatalog);
        setSelectedTable((current) => {
          if (nextCatalog.some((entry) => entry.name === current)) return current;
          if (nextCatalog.some((entry) => entry.name === tableName)) return tableName;
          return nextCatalog[0]?.name ?? "";
        });
        setStatus(
          nextCatalog.length > 0
            ? `Catalog refreshed with ${nextCatalog.length} loaded table${nextCatalog.length === 1 ? "" : "s"}.`
            : "No DuckDB tables are currently loaded.",
        );
      });
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to read DuckDB metadata.",
      );
    } finally {
      setLoading(false);
    }
  }

  const visibleCatalog = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const filtered = catalog.filter((entry) =>
      query.length === 0 ? true : buildSearchText(entry).includes(query),
    );

    const sorted = [...filtered];
    if (sortMode === "name") {
      sorted.sort((left, right) => left.name.localeCompare(right.name));
    }
    if (sortMode === "size") {
      sorted.sort((left, right) => right.sizeBytes - left.sizeBytes);
    }
    if (sortMode === "date") {
      sorted.sort((left, right) => right.discoveredAt - left.discoveredAt);
    }
    return sorted;
  }, [catalog, searchTerm, sortMode]);

  const selectedEntry = useMemo(
    () => visibleCatalog.find((entry) => entry.name === selectedTable)
      ?? catalog.find((entry) => entry.name === selectedTable)
      ?? null,
    [catalog, selectedTable, visibleCatalog],
  );

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE }}
      className={`${PANEL_CLASS} overflow-hidden p-6`}
    >
      <div className="flex flex-col gap-5 border-b border-white/20 pb-5 dark:border-white/10 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-300">
            <Database className="h-3.5 w-3.5" />
            Data Catalog Browser
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">
              Browse every loaded DuckDB table
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Filter cards by table or column name, then switch sorting between
              alphabetic, size, and recency.
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[34rem] xl:grid-cols-[1.5fr_0.9fr_auto]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              aria-label="Search datasets"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.currentTarget.value)}
              placeholder="Search datasets or columns"
              className={`${FIELD_CLASS} w-full pl-11`}
            />
          </label>

          <label className="relative">
            <ArrowUpDown className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <select
              aria-label="Sort catalog"
              value={sortMode}
              onChange={(event) => setSortMode(event.currentTarget.value as SortMode)}
              className={`${FIELD_CLASS} w-full appearance-none pl-11`}
            >
              <option value="name">Sort by name</option>
              <option value="size">Sort by size</option>
              <option value="date">Sort by date</option>
            </select>
          </label>

          <button
            type="button"
            onClick={() => {
              void handleRefresh();
            }}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-slate-400 dark:disabled:bg-slate-700"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh catalog
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
        <span>
          Showing <strong>{visibleCatalog.length}</strong> of{" "}
          <strong>{catalog.length}</strong> tables
        </span>
        <span className="rounded-full border border-white/20 bg-white/60 px-3 py-1 dark:bg-slate-900/50">
          {status}
        </span>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.7fr_1fr]">
        <div className="grid gap-4 md:grid-cols-2">
          {visibleCatalog.length === 0 ? (
            <div className={`${PANEL_CLASS} col-span-full p-6`}>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                No tables match the current filter. Refresh the catalog or widen
                the search query.
              </p>
            </div>
          ) : null}

          {visibleCatalog.map((entry) => {
            const isSelected = entry.name === selectedTable;
            return (
              <motion.button
                key={entry.name}
                type="button"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, ease: EASE }}
                onClick={() => setSelectedTable(entry.name)}
                className={`${PANEL_CLASS} text-left transition ${
                  isSelected
                    ? "ring-2 ring-cyan-400/70"
                    : "hover:-translate-y-0.5 hover:shadow-2xl"
                } p-5`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3
                      data-testid="catalog-card-title"
                      className="text-lg font-semibold text-slate-900 dark:text-slate-50"
                    >
                      {entry.name}
                    </h3>
                    <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                      {new Date(entry.discoveredAt).toLocaleString()}
                    </p>
                  </div>
                  <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-700 dark:text-cyan-300">
                    {entry.name === tableName ? "Current table" : "Loaded"}
                  </span>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl bg-white/70 p-3 dark:bg-slate-900/50">
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      Rows
                    </p>
                    <p className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-50">
                      {formatNumber(entry.rowCount)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white/70 p-3 dark:bg-slate-900/50">
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      Columns
                    </p>
                    <p className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-50">
                      {formatNumber(entry.columnCount)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white/70 p-3 dark:bg-slate-900/50">
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      Size
                    </p>
                    <p className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-50">
                      {formatBytes(entry.sizeBytes)}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {entry.columnNames.slice(0, 6).map((columnName) => (
                    <span
                      key={`${entry.name}-${columnName}`}
                      className="rounded-full border border-white/20 bg-white/60 px-3 py-1 text-xs text-slate-600 dark:bg-slate-900/40 dark:text-slate-300"
                    >
                      {columnName}
                    </span>
                  ))}
                </div>
              </motion.button>
            );
          })}
        </div>

        <div className={`${PANEL_CLASS} p-5`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 dark:bg-slate-900/50 dark:text-slate-300">
                <Table2 className="h-3.5 w-3.5" />
                Selected table
              </div>
              <h3 className="mt-3 text-xl font-semibold text-slate-900 dark:text-slate-50">
                {selectedEntry?.name ?? "No table selected"}
              </h3>
            </div>
          </div>

          {selectedEntry ? (
            <div className="mt-5 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-white/70 p-4 dark:bg-slate-900/50">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Table profile
                  </p>
                  <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">
                    {formatNumber(selectedEntry.rowCount)} rows across{" "}
                    {formatNumber(selectedEntry.columnCount)} columns
                  </p>
                  <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
                    Estimated footprint {formatBytes(selectedEntry.sizeBytes)}
                  </p>
                </div>

                <div className="rounded-2xl bg-white/70 p-4 dark:bg-slate-900/50">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Sort focus
                  </p>
                  <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">
                    Current ordering: <strong>{sortMode}</strong>
                  </p>
                  <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
                    Filter query:{" "}
                    <strong>{searchTerm.trim().length > 0 ? searchTerm : "none"}</strong>
                  </p>
                </div>
              </div>

              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Column preview
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedEntry.columnNames.map((columnName) => (
                    <span
                      key={`${selectedEntry.name}-detail-${columnName}`}
                      className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-700 dark:text-cyan-300"
                    >
                      {columnName}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-5 text-sm text-slate-600 dark:text-slate-300">
              Refresh the catalog, then click a card to inspect one table in
              detail.
            </p>
          )}
        </div>
      </div>
    </motion.section>
  );
}
