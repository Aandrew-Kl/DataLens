"use client";

import {
  Suspense,
  startTransition,
  use,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
} from "react";
import { motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Copy,
  Filter,
  Hash,
  Info,
  Rows3,
  Search,
  ToggleLeft,
  Type,
} from "lucide-react";
import { useColumnStats } from "@/hooks/use-column-stats";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile, ColumnType } from "@/types/dataset";

interface DataPreviewProps {
  tableName: string;
  columns: ColumnProfile[];
  previewRows: Record<string, unknown>[];
}

interface PreviewDataResult {
  rows: Record<string, unknown>[];
  totalRows: number;
}

interface SortState {
  column: string | null;
  direction: "asc" | "desc" | null;
}

interface ResizeState {
  column: string;
  startX: number;
  startWidth: number;
}

interface ContextMenuState {
  x: number;
  y: number;
  row: Record<string, unknown>;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
const PANEL_CLASS =
  "rounded-[1.8rem] border border-white/15 bg-white/60 shadow-[0_24px_90px_-46px_rgba(15,23,42,0.76)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";

const TYPE_META: Record<
  ColumnType,
  { Icon: typeof Type; badge: string; label: string }
> = {
  string: {
    Icon: Type,
    badge: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
    label: "String",
  },
  number: {
    Icon: Hash,
    badge: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
    label: "Number",
  },
  date: {
    Icon: Calendar,
    badge: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
    label: "Date",
  },
  boolean: {
    Icon: ToggleLeft,
    badge: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
    label: "Boolean",
  },
  unknown: {
    Icon: Info,
    badge: "bg-slate-500/12 text-slate-700 dark:text-slate-300",
    label: "Unknown",
  },
};

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function buildWhereClause(filters: Record<string, string>) {
  const entries = Object.entries(filters)
    .map(([column, value]) => [column, value.trim()] as const)
    .filter(([, value]) => value.length > 0);

  if (entries.length === 0) {
    return "";
  }

  const predicates = entries.map(
    ([column, value]) =>
      `CAST(${quoteIdentifier(column)} AS VARCHAR) ILIKE ${quoteLiteral(`%${value}%`)}`,
  );

  return `WHERE ${predicates.join(" AND ")}`;
}

function buildOrderClause(sort: SortState) {
  if (!sort.column || !sort.direction) {
    return "";
  }

  const safeColumn = quoteIdentifier(sort.column);
  return `ORDER BY ${safeColumn} IS NULL, ${safeColumn} ${sort.direction.toUpperCase()}`;
}

function buildPageQuery(
  tableName: string,
  columns: ColumnProfile[],
  sort: SortState,
  filters: Record<string, string>,
  page: number,
  pageSize: number,
) {
  const selectList = columns.map((column) => quoteIdentifier(column.name)).join(", ");
  const whereClause = buildWhereClause(filters);
  const orderClause = buildOrderClause(sort);
  const offset = (page - 1) * pageSize;

  return `SELECT ${selectList} FROM ${quoteIdentifier(tableName)} ${whereClause} ${orderClause} LIMIT ${pageSize} OFFSET ${offset}`;
}

async function loadPreviewData(
  tableName: string,
  columns: ColumnProfile[],
  sort: SortState,
  filters: Record<string, string>,
  page: number,
  pageSize: number,
): Promise<PreviewDataResult> {
  const whereClause = buildWhereClause(filters);
  const [rows, countRows] = await Promise.all([
    runQuery(buildPageQuery(tableName, columns, sort, filters, page, pageSize)),
    runQuery(`SELECT COUNT(*) AS cnt FROM ${quoteIdentifier(tableName)} ${whereClause}`),
  ]);

  return {
    rows,
    totalRows: Number(countRows[0]?.cnt ?? 0),
  };
}

function defaultColumnWidth(column: ColumnProfile) {
  if (column.type === "number") {
    return 164;
  }
  if (column.type === "date") {
    return 188;
  }
  if (column.type === "boolean") {
    return 150;
  }
  return 220;
}

function formatCellValue(value: unknown, type: ColumnType) {
  if (value == null) {
    return "null";
  }

  if (type === "number") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? formatNumber(numeric) : String(value);
  }

  if (type === "date") {
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime())
      ? String(value)
      : parsed.toLocaleString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
  }

  if (type === "boolean") {
    return String(value);
  }

  return String(value);
}

function rowKey(row: Record<string, unknown>, index: number) {
  return `${index}:${JSON.stringify(row)}`;
}

function SortIcon({ active, direction }: { active: boolean; direction: SortState["direction"] }) {
  if (!active) {
    return <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />;
  }

  return direction === "desc" ? (
    <ArrowDown className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-300" />
  ) : (
    <ArrowUp className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-300" />
  );
}

function ColumnStatsPopover({
  tableName,
  column,
}: {
  tableName: string;
  column: ColumnProfile;
}) {
  const stats = useColumnStats(tableName, column.name);

  return (
    <div className="absolute left-0 top-full z-30 mt-2 w-72 rounded-[1.1rem] border border-white/15 bg-white/88 p-4 text-left shadow-[0_18px_54px_-34px_rgba(15,23,42,0.8)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/92">
      <div className="text-sm font-semibold text-slate-950 dark:text-white">{column.name}</div>
      <div className="mt-3 grid gap-2 text-xs text-slate-600 dark:text-slate-300">
        <div className="flex items-center justify-between">
          <span>Rows</span>
          <span className="font-medium">{formatNumber(stats.count)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Nulls</span>
          <span className="font-medium">{formatNumber(stats.nullCount)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Distinct</span>
          <span className="font-medium">{formatNumber(stats.distinctCount)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Min</span>
          <span className="font-medium">{stats.min == null ? "—" : String(stats.min)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Max</span>
          <span className="font-medium">{stats.max == null ? "—" : String(stats.max)}</span>
        </div>
        {column.type === "number" ? (
          <>
            <div className="flex items-center justify-between">
              <span>Mean</span>
              <span className="font-medium">
                {stats.mean == null ? "—" : formatNumber(stats.mean)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Median</span>
              <span className="font-medium">
                {stats.median == null ? "—" : formatNumber(stats.median)}
              </span>
            </div>
          </>
        ) : null}
        {stats.loading ? (
          <div className="pt-2 text-slate-500 dark:text-slate-400">Loading column statistics…</div>
        ) : null}
      </div>
    </div>
  );
}

function DataPreviewReady({ tableName, columns }: DataPreviewProps) {
  const [sort, setSort] = useState<SortState>({ column: null, direction: null });
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(25);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [hoveredColumn, setHoveredColumn] = useState<string | null>(null);
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const dataPromise = useMemo(
    () => loadPreviewData(tableName, columns, sort, filters, page, pageSize),
    [columns, filters, page, pageSize, sort, tableName],
  );
  const result = use(dataPromise);
  const totalPages = Math.max(1, Math.ceil(result.totalRows / pageSize));
  const selectedRow = result.rows.find((row, index) => rowKey(row, index) === selectedRowKey) ?? null;

  function closeContextMenu() {
    startTransition(() => setContextMenu(null));
  }

  const applyResize = useEffectEvent((event: MouseEvent) => {
    if (!resizeState) {
      return;
    }

    const nextWidth = Math.max(120, resizeState.startWidth + event.clientX - resizeState.startX);
    startTransition(() => {
      setWidths((current) => ({ ...current, [resizeState.column]: nextWidth }));
    });
  });

  const stopResize = useEffectEvent(() => {
    if (resizeState) {
      startTransition(() => setResizeState(null));
    }
  });

  useEffect(() => {
    if (!resizeState) {
      return;
    }

    window.addEventListener("mousemove", applyResize);
    window.addEventListener("mouseup", stopResize);
    return () => {
      window.removeEventListener("mousemove", applyResize);
      window.removeEventListener("mouseup", stopResize);
    };
  }, [resizeState]);

  function updateFilter(columnName: string, value: string) {
    startTransition(() => {
      setFilters((current) => ({ ...current, [columnName]: value }));
      setPage(1);
      setSelectedRowKey(null);
    });
  }

  function toggleSort(columnName: string) {
    startTransition(() => {
      setSort((current) => {
        if (current.column !== columnName) {
          return { column: columnName, direction: "asc" };
        }

        if (current.direction === "asc") {
          return { column: columnName, direction: "desc" };
        }

        if (current.direction === "desc") {
          return { column: null, direction: null };
        }

        return { column: columnName, direction: "asc" };
      });
      setPage(1);
    });
  }

  async function copyRowAsJson(row: Record<string, unknown>) {
    await window.navigator.clipboard.writeText(JSON.stringify(row, null, 2));
    closeContextMenu();
  }

  return (
    <section className={`${PANEL_CLASS} p-5`}>
      <div className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-300">
            <Rows3 className="h-3.5 w-3.5" />
            Dataset browser
          </div>
          <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Enhanced preview</h2>
          <p className="max-w-2xl text-sm text-slate-600 dark:text-slate-300">
            Resize columns, sort and filter inline, inspect per-column statistics, and drill into row-level detail for{" "}
            <span className="font-medium text-slate-950 dark:text-white">{tableName}</span>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-2xl border border-white/15 bg-white/50 px-4 py-3 dark:border-white/10 dark:bg-slate-950/35">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Filtered rows
            </div>
            <div className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">
              {formatNumber(result.totalRows)}
            </div>
          </div>
          <label className="rounded-2xl border border-white/15 bg-white/50 px-4 py-3 text-sm dark:border-white/10 dark:bg-slate-950/35">
            <span className="mr-3 text-slate-500 dark:text-slate-400">Page size</span>
            <select
              value={pageSize}
              onChange={(event) =>
                startTransition(() => {
                  setPageSize(Number(event.target.value) as (typeof PAGE_SIZE_OPTIONS)[number]);
                  setPage(1);
                })
              }
              className="bg-transparent font-medium text-slate-950 outline-none dark:text-white"
            >
              {PAGE_SIZE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="mt-5 overflow-x-auto rounded-[1.3rem] border border-white/10">
        <table className="min-w-full border-separate border-spacing-0">
          <thead className="sticky top-0 z-10 bg-white/85 backdrop-blur-xl dark:bg-slate-950/85">
            <tr>
              {columns.map((column) => {
                const typeMeta = TYPE_META[column.type];
                const Icon = typeMeta.Icon;
                const width = widths[column.name] ?? defaultColumnWidth(column);

                return (
                  <th
                    key={column.name}
                    className="relative border-b border-white/10 px-4 pb-4 pt-3 text-left align-top"
                    style={{ width, minWidth: width }}
                  >
                    <div
                      className="relative"
                      onMouseEnter={() => setHoveredColumn(column.name)}
                      onMouseLeave={() => setHoveredColumn((current) => (current === column.name ? null : current))}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(column.name)}
                        className="flex w-full items-start justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-950 dark:text-white">
                            {column.name}
                          </div>
                          <div className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${typeMeta.badge}`}>
                            <Icon className="h-3 w-3" />
                            {typeMeta.label}
                          </div>
                        </div>
                        <SortIcon active={sort.column === column.name} direction={sort.direction} />
                      </button>

                      <div className="mt-3 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/45 px-3 py-2 dark:bg-slate-950/35">
                        <Filter className="h-3.5 w-3.5 text-slate-400" />
                        <input
                          value={filters[column.name] ?? ""}
                          onChange={(event) => updateFilter(column.name, event.target.value)}
                          placeholder="Filter..."
                          className="w-full bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-200"
                        />
                      </div>

                      {hoveredColumn === column.name ? (
                        <ColumnStatsPopover tableName={tableName} column={column} />
                      ) : null}
                    </div>

                    <button
                      type="button"
                      aria-label={`Resize ${column.name}`}
                      onMouseDown={(event) =>
                        setResizeState({
                          column: column.name,
                          startX: event.clientX,
                          startWidth: width,
                        })
                      }
                      className="absolute right-0 top-0 h-full w-3 cursor-col-resize"
                    />
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {result.rows.map((row, index) => {
              const currentRowKey = rowKey(row, index);
              const selected = selectedRowKey === currentRowKey;

              return (
                <tr
                  key={currentRowKey}
                  onClick={() =>
                    startTransition(() =>
                      setSelectedRowKey((current) => (current === currentRowKey ? null : currentRowKey)),
                    )
                  }
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setContextMenu({ x: event.clientX, y: event.clientY, row });
                  }}
                  className={`cursor-pointer transition ${
                    selected
                      ? "bg-cyan-500/10"
                      : index % 2 === 0
                        ? "bg-white/18 dark:bg-white/0"
                        : "bg-slate-100/25 dark:bg-slate-900/22"
                  }`}
                >
                  {columns.map((column) => {
                    const width = widths[column.name] ?? defaultColumnWidth(column);
                    const value = row[column.name];
                    const isNull = value == null;

                    return (
                      <td
                        key={`${currentRowKey}:${column.name}`}
                        className="border-b border-white/8 px-4 py-3 text-sm text-slate-700 dark:text-slate-200"
                        style={{ width, minWidth: width }}
                      >
                        {isNull ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-rose-400/30 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-700 dark:text-rose-300">
                            null
                          </span>
                        ) : (
                          <span className="line-clamp-2 break-words">
                            {formatCellValue(value, column.type)}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <Search className="h-4 w-4 text-cyan-500" />
          Page {page} of {totalPages}
          <span className="text-slate-400">•</span>
          Showing {result.rows.length} row{result.rows.length === 1 ? "" : "s"}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => startTransition(() => setPage((current) => Math.max(1, current - 1)))}
            disabled={page <= 1}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-300/30 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10 dark:bg-slate-950/35 dark:text-slate-100"
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </button>
          <button
            type="button"
            onClick={() => startTransition(() => setPage((current) => Math.min(totalPages, current + 1)))}
            disabled={page >= totalPages}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-300/30 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10 dark:bg-slate-950/35 dark:text-slate-100"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {selectedRow ? (
        <motion.aside
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: EASE }}
          className="mt-5 rounded-[1.3rem] border border-white/10 bg-white/45 p-5 backdrop-blur-xl dark:bg-slate-950/35"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Row detail
              </div>
              <h3 className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
                Selected record
              </h3>
            </div>
            <button
              type="button"
              onClick={() => void copyRowAsJson(selectedRow)}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-300/30 dark:border-white/10 dark:bg-slate-950/35 dark:text-slate-100"
            >
              <Copy className="h-4 w-4" />
              Copy row as JSON
            </button>
          </div>

          <pre className="mt-4 overflow-x-auto rounded-[1.1rem] border border-white/10 bg-slate-950/90 p-4 text-xs leading-6 text-slate-200">
            {JSON.stringify(selectedRow, null, 2)}
          </pre>
        </motion.aside>
      ) : null}

      {contextMenu ? (
        <div
          className="fixed inset-0 z-50"
          onMouseDown={closeContextMenu}
        >
          <div
            className="absolute rounded-2xl border border-white/15 bg-white/88 p-2 shadow-[0_18px_54px_-34px_rgba(15,23,42,0.8)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/94"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => void copyRowAsJson(contextMenu.row)}
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 transition hover:bg-cyan-500/10 dark:text-slate-200"
            >
              <Copy className="h-4 w-4" />
              Copy row as JSON
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function DataPreviewFallback({
  columns,
  previewRows,
}: Pick<DataPreviewProps, "columns" | "previewRows">) {
  return (
    <section className={`${PANEL_CLASS} p-5`}>
      <div className="animate-pulse space-y-4">
        <div className="h-6 w-40 rounded-full bg-white/45 dark:bg-slate-800/70" />
        <div className="overflow-hidden rounded-[1.3rem] border border-white/10">
          <table className="min-w-full">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.name} className="px-4 py-3 text-left">
                    <div className="h-4 w-24 rounded-full bg-white/35 dark:bg-slate-800/60" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.slice(0, 5).map((row, rowIndex) => (
                <tr key={rowKey(row, rowIndex)}>
                  {columns.map((column) => (
                    <td key={`${rowIndex}:${column.name}`} className="px-4 py-3">
                      <div className="h-3.5 w-32 rounded-full bg-white/30 dark:bg-slate-800/55" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export default function DataPreview(props: DataPreviewProps) {
  return (
    <Suspense fallback={<DataPreviewFallback columns={props.columns} previewRows={props.previewRows} />}>
      <DataPreviewReady {...props} />
    </Suspense>
  );
}
