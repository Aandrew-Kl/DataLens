"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
  type CSSProperties,
  type UIEvent,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  CircleHelp,
  DatabaseZap,
  Hash,
  Loader2,
  Rows3,
  Search,
  Table2,
  ToggleLeft,
  Type,
  X,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile, ColumnType } from "@/types/dataset";

interface VirtualDataGridProps {
  tableName: string;
  columns: ColumnProfile[];
  totalRows: number;
}

type GridRow = Record<string, unknown>;
type SortDirection = "asc" | "desc" | null;
type PageMap = Map<number, GridRow[]>;

interface SortState {
  column: string | null;
  direction: SortDirection;
}

const PAGE_SIZE = 100;
const ROW_HEIGHT = 44;
const OVERSCAN = 8;
const GRID_HEIGHT = 620;
const BASE_COLUMN_WIDTH = 72;

const TYPE_META: Record<
  ColumnType,
  { label: string; badge: string; text: string; Icon: React.ElementType }
> = {
  string: {
    label: "String",
    badge: "bg-emerald-100 dark:bg-emerald-900/40",
    text: "text-emerald-700 dark:text-emerald-300",
    Icon: Type,
  },
  number: {
    label: "Number",
    badge: "bg-sky-100 dark:bg-sky-900/40",
    text: "text-sky-700 dark:text-sky-300",
    Icon: Hash,
  },
  date: {
    label: "Date",
    badge: "bg-violet-100 dark:bg-violet-900/40",
    text: "text-violet-700 dark:text-violet-300",
    Icon: Calendar,
  },
  boolean: {
    label: "Boolean",
    badge: "bg-amber-100 dark:bg-amber-900/40",
    text: "text-amber-700 dark:text-amber-300",
    Icon: ToggleLeft,
  },
  unknown: {
    label: "Unknown",
    badge: "bg-gray-100 dark:bg-gray-800",
    text: "text-gray-600 dark:text-gray-300",
    Icon: CircleHelp,
  },
};

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildColumnSignature(columns: ColumnProfile[]): string {
  return columns.map((column) => column.name).join("\u0001");
}

function getColumnTrack(column: ColumnProfile): string {
  if (column.type === "number") return "minmax(140px, 0.95fr)";
  if (column.type === "date") return "minmax(170px, 1fr)";
  if (column.type === "boolean") return "minmax(130px, 0.85fr)";
  return "minmax(200px, 1.3fr)";
}

function getMinGridWidth(columns: ColumnProfile[]): number {
  return columns.reduce((width, column) => {
    if (column.type === "number") return width + 140;
    if (column.type === "date") return width + 170;
    if (column.type === "boolean") return width + 130;
    return width + 200;
  }, BASE_COLUMN_WIDTH);
}

function buildSearchClause(columns: ColumnProfile[], term: string): string {
  if (!term.trim()) return "";
  const pattern = quoteLiteral(`%${term.trim()}%`);
  const predicates = columns.map(
    (column) => `CAST(${quoteIdentifier(column.name)} AS VARCHAR) ILIKE ${pattern}`
  );
  return `WHERE (${predicates.join(" OR ")})`;
}

function buildOrderClause(sort: SortState): string {
  if (!sort.column || !sort.direction) return "";
  const safeColumn = quoteIdentifier(sort.column);
  return `ORDER BY ${safeColumn} IS NULL, ${safeColumn} ${sort.direction.toUpperCase()}`;
}

function buildCountQuery(tableName: string, columns: ColumnProfile[], term: string): string {
  return `SELECT COUNT(*) AS cnt FROM ${quoteIdentifier(tableName)} ${buildSearchClause(columns, term)}`;
}

function buildPageQuery(
  tableName: string,
  columns: ColumnProfile[],
  term: string,
  sort: SortState,
  offset: number
): string {
  const selectList = columns.map((column) => quoteIdentifier(column.name)).join(", ");
  const safeTable = quoteIdentifier(tableName);
  const whereClause = buildSearchClause(columns, term);
  const orderClause = buildOrderClause(sort);

  return `SELECT ${selectList} FROM ${safeTable} ${whereClause} ${orderClause} LIMIT ${PAGE_SIZE} OFFSET ${offset}`;
}

function formatCellValue(value: unknown, type: ColumnType): string {
  if (value === null || value === undefined) return "null";
  if (type === "number") {
    const numeric = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numeric) ? formatNumber(numeric) : String(value);
  }
  if (type === "date") {
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime())
      ? String(value)
      : parsed.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  }
  if (type === "boolean") {
    return typeof value === "boolean"
      ? (value ? "true" : "false")
      : (String(value).toLowerCase() === "true" ? "true" : "false");
  }
  return String(value);
}

function TypeBadge({ type }: { type: ColumnType }) {
  const meta = TYPE_META[type];
  const Icon = meta.Icon;
  return (
    <span className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.badge} ${meta.text}`}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

function SortIcon({ active, direction }: { active: boolean; direction: SortDirection }) {
  if (!active) return <ArrowUpDown className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500" />;
  return direction === "desc" ? (
    <ArrowDown className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
  ) : (
    <ArrowUp className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
  );
}

function LoadingRow({
  rowIndex,
  columnCount,
  gridTemplateColumns,
  style,
}: {
  rowIndex: number;
  columnCount: number;
  gridTemplateColumns: string;
  style: CSSProperties;
}) {
  const striped = rowIndex % 2 === 0;
  return (
    <div
      style={{ ...style, gridTemplateColumns }}
      className={`grid items-center border-b border-gray-200/70 dark:border-gray-800 ${
        striped ? "bg-white dark:bg-gray-900" : "bg-gray-50/70 dark:bg-gray-950/70"
      }`}
    >
      <div className="px-4 text-xs font-mono text-gray-300 dark:text-gray-600">{rowIndex + 1}</div>
      {Array.from({ length: columnCount }, (_, index) => (
        <div key={index} className="px-4">
          <div className="h-3.5 w-3/4 animate-pulse rounded-full bg-gray-200 dark:bg-gray-800" />
        </div>
      ))}
    </div>
  );
}

export default function VirtualDataGrid({
  tableName,
  columns,
  totalRows,
}: VirtualDataGridProps) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState>({ column: null, direction: null });
  const [rowCount, setRowCount] = useState(totalRows);
  const [countLoading, setCountLoading] = useState(false);
  const [requestCount, setRequestCount] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(GRID_HEIGHT);
  const [headerHeight, setHeaderHeight] = useState(74);
  const [error, setError] = useState<string | null>(null);
  const [activePages, setActivePages] = useState<PageMap>(new Map());

  const deferredSearch = useDeferredValue(search);
  const normalizedSearch = deferredSearch.trim();
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const activeQueryKeyRef = useRef("");
  const pageCacheRef = useRef(new Map<string, PageMap>());
  const requestCacheRef = useRef(new Map<string, Map<number, Promise<void>>>());
  const countCacheRef = useRef(new Map<string, number>());

  const columnSignature = useMemo(() => buildColumnSignature(columns), [columns]);
  const gridTemplateColumns = useMemo(
    () => ["72px", ...columns.map((column) => getColumnTrack(column))].join(" "),
    [columns]
  );
  const minGridWidth = useMemo(() => getMinGridWidth(columns), [columns]);
  const countKey = useMemo(
    () => [tableName, columnSignature, normalizedSearch.toLowerCase()].join("\u0000"),
    [tableName, columnSignature, normalizedSearch]
  );
  const queryKey = useMemo(
    () => [countKey, sort.column ?? "", sort.direction ?? ""].join("\u0000"),
    [countKey, sort.column, sort.direction]
  );

  const ensurePageCache = useCallback((key: string) => {
    let cache = pageCacheRef.current.get(key);
    if (!cache) {
      cache = new Map<number, GridRow[]>();
      pageCacheRef.current.set(key, cache);
    }
    return cache;
  }, []);

  const ensureRequestCache = useCallback((key: string) => {
    let cache = requestCacheRef.current.get(key);
    if (!cache) {
      cache = new Map<number, Promise<void>>();
      requestCacheRef.current.set(key, cache);
    }
    return cache;
  }, []);

  const syncActivePages = useCallback(
    (key: string) => {
      setActivePages(new Map(ensurePageCache(key)));
    },
    [ensurePageCache]
  );

  const loadPage = useCallback(
    async (key: string, pageIndex: number, term: string, nextSort: SortState) => {
      const pageCache = ensurePageCache(key);
      if (pageCache.has(pageIndex)) return;

      const requestCache = ensureRequestCache(key);
      const existing = requestCache.get(pageIndex);
      if (existing) return existing;

      startTransition(() => {
        setError(null);
        setRequestCount((count) => count + 1);
      });

      const request = runQuery(
        buildPageQuery(tableName, columns, term, nextSort, pageIndex * PAGE_SIZE)
      )
        .then((rows) => {
          pageCache.set(pageIndex, rows);
          if (activeQueryKeyRef.current === key) {
            startTransition(() => syncActivePages(key));
          }
        })
        .catch((nextError) => {
          setError(nextError instanceof Error ? nextError.message : "Failed to fetch rows.");
        })
        .finally(() => {
          requestCache.delete(pageIndex);
          setRequestCount((count) => Math.max(0, count - 1));
        });

      requestCache.set(pageIndex, request);
      return request;
    },
    [columns, ensurePageCache, ensureRequestCache, syncActivePages, tableName]
  );

  useEffect(() => {
    const scrollElement = scrollRef.current;
    const headerElement = headerRef.current;
    if (!scrollElement || !headerElement) return;

    const updateMeasurements = () => {
      setViewportHeight(scrollElement.clientHeight);
      setHeaderHeight(headerElement.offsetHeight);
    };

    updateMeasurements();
    const observer = new ResizeObserver(updateMeasurements);
    observer.observe(scrollElement);
    observer.observe(headerElement);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    activeQueryKeyRef.current = queryKey;
    startTransition(() => syncActivePages(queryKey));
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: 0 });
    startTransition(() => setScrollTop(0));
  }, [queryKey, syncActivePages]);

  useEffect(() => {
    if (!normalizedSearch) {
      startTransition(() => {
        setRowCount(totalRows);
        setCountLoading(false);
        setError(null);
      });
      return;
    }

    const cachedCount = countCacheRef.current.get(countKey);
    if (cachedCount !== undefined) {
      startTransition(() => {
        setRowCount(cachedCount);
        setCountLoading(false);
        setError(null);
      });
      return;
    }

    let cancelled = false;
    startTransition(() => {
      setCountLoading(true);
      setRowCount(0);
      setError(null);
      setRequestCount((count) => count + 1);
    });

    runQuery(buildCountQuery(tableName, columns, normalizedSearch))
      .then((rows) => {
        if (cancelled) return;
        const nextCount = Number(rows[0]?.cnt ?? 0);
        countCacheRef.current.set(countKey, nextCount);
        setRowCount(nextCount);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Failed to count rows.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCountLoading(false);
          setRequestCount((count) => Math.max(0, count - 1));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [columns, countKey, normalizedSearch, tableName, totalRows]);

  const bodyViewportHeight = Math.max(viewportHeight - headerHeight, ROW_HEIGHT * 4);
  const totalHeight = Math.max(rowCount * ROW_HEIGHT, bodyViewportHeight);
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(rowCount, Math.ceil((scrollTop + bodyViewportHeight) / ROW_HEIGHT) + OVERSCAN);
  const visibleIndices = useMemo(
    () => Array.from({ length: Math.max(0, endIndex - startIndex) }, (_, index) => startIndex + index),
    [startIndex, endIndex]
  );
  const offsetY = startIndex * ROW_HEIGHT;

  useEffect(() => {
    if (countLoading || rowCount === 0) return;
    const totalPages = Math.max(1, Math.ceil(rowCount / PAGE_SIZE));
    const firstPage = Math.max(0, Math.floor(startIndex / PAGE_SIZE) - 1);
    const lastPage = Math.min(totalPages - 1, Math.floor(Math.max(endIndex - 1, 0) / PAGE_SIZE) + 1);
    for (let pageIndex = firstPage; pageIndex <= lastPage; pageIndex += 1) {
      void loadPage(queryKey, pageIndex, normalizedSearch, sort);
    }
  }, [countLoading, endIndex, loadPage, normalizedSearch, queryKey, rowCount, sort, startIndex]);

  const handleSort = useCallback((columnName: string) => {
    setSort((previous) => {
      if (previous.column !== columnName) return { column: columnName, direction: "asc" };
      if (previous.direction === "asc") return { column: columnName, direction: "desc" };
      return { column: null, direction: null };
    });
  }, []);

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const nextTop = event.currentTarget.scrollTop;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      startTransition(() => setScrollTop(nextTop));
    });
  }, []);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const renderedRows = useMemo(
    () =>
      visibleIndices.map((rowIndex) => {
        const pageIndex = Math.floor(rowIndex / PAGE_SIZE);
        const row = activePages.get(pageIndex)?.[rowIndex % PAGE_SIZE];
        return { rowIndex, row };
      }),
    [activePages, visibleIndices]
  );

  const loadingRows = useMemo(
    () => Array.from({ length: Math.max(8, Math.ceil(bodyViewportHeight / ROW_HEIGHT)) }, (_, index) => index),
    [bodyViewportHeight]
  );

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="w-full rounded-2xl border border-gray-200/70 bg-white/90 shadow-sm backdrop-blur-sm dark:border-gray-800 dark:bg-gray-900/90"
    >
      <div className="border-b border-gray-200/70 px-4 py-4 dark:border-gray-800">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex items-center gap-2">
              <Table2 className="h-4 w-4 text-sky-600 dark:text-sky-400" />
              <h2 className="truncate text-sm font-semibold text-gray-900 dark:text-white">{tableName}</h2>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                {formatNumber(totalRows)} rows
              </span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                {columns.length} cols
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 dark:bg-gray-800">
                <Rows3 className="h-3 w-3" />
                {formatNumber(rowCount)} visible
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 dark:bg-gray-800">
                <DatabaseZap className="h-3 w-3" />
                {activePages.size} cached pages
              </span>
              <AnimatePresence initial={false}>
                {(countLoading || requestCount > 0) && (
                  <motion.span
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-1 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
                  >
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Fetching data
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="relative min-w-[280px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search across all columns..."
              className="w-full rounded-xl border border-gray-200 bg-white py-2 pl-10 pr-9 text-sm text-gray-900 outline-none transition focus:border-sky-400 dark:border-gray-700 dark:bg-gray-950 dark:text-white dark:focus:border-sky-500"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition hover:text-gray-700 dark:hover:text-gray-200"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <AnimatePresence initial={false}>
          {normalizedSearch && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-300"
            >
              <span className="rounded-full bg-sky-100 px-2.5 py-1 font-medium text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                Filter: {normalizedSearch}
              </span>
              <span className="text-gray-500 dark:text-gray-400">
                Search is evaluated in DuckDB so sorting and virtualization stay aligned.
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div ref={scrollRef} onScroll={handleScroll} className="relative overflow-auto" style={{ height: GRID_HEIGHT }}>
        <div
          ref={headerRef}
          className="sticky top-0 z-20 border-b border-gray-200/80 bg-white/95 backdrop-blur-sm dark:border-gray-800 dark:bg-gray-900/95"
          style={{ minWidth: minGridWidth }}
        >
          <div className="grid" style={{ gridTemplateColumns }}>
            <div className="border-r border-gray-200/70 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:border-gray-800 dark:text-gray-400">
              Row
            </div>
            {columns.map((column) => {
              const active = sort.column === column.name;
              return (
                <button
                  key={column.name}
                  type="button"
                  onClick={() => handleSort(column.name)}
                  className="flex min-w-0 items-center justify-between gap-3 border-r border-gray-200/70 px-4 py-3 text-left transition hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-950"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">{column.name}</div>
                    <TypeBadge type={column.type} />
                  </div>
                  <SortIcon active={active} direction={sort.direction} />
                </button>
              );
            })}
          </div>
        </div>

        {error ? (
          <div className="flex h-[420px] min-w-max items-center justify-center px-6" style={{ minWidth: minGridWidth }}>
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="max-w-md rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
            >
              {error}
            </motion.div>
          </div>
        ) : countLoading ? (
          <div className="relative min-w-max" style={{ minWidth: minGridWidth }}>
            {loadingRows.map((rowIndex) => (
              <LoadingRow
                key={rowIndex}
                rowIndex={rowIndex}
                columnCount={columns.length}
                gridTemplateColumns={gridTemplateColumns}
                style={{ height: ROW_HEIGHT }}
              />
            ))}
          </div>
        ) : rowCount === 0 ? (
          <div className="flex h-[420px] min-w-max items-center justify-center px-6" style={{ minWidth: minGridWidth }}>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex max-w-sm flex-col items-center gap-3 text-center"
            >
              <DatabaseZap className="h-10 w-10 text-gray-300 dark:text-gray-600" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">No rows match this filter.</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Try a different search term or clear the current filter.</p>
              </div>
            </motion.div>
          </div>
        ) : (
          <div className="relative min-w-max" style={{ height: totalHeight, minWidth: minGridWidth }}>
            <div style={{ transform: `translateY(${offsetY}px)` }}>
              {renderedRows.map(({ rowIndex, row }) => {
                const striped = rowIndex % 2 === 0;
                const rowStyle: CSSProperties = { height: ROW_HEIGHT, gridTemplateColumns };

                if (!row) {
                  return (
                    <LoadingRow
                      key={`${queryKey}-${rowIndex}-loading`}
                      rowIndex={rowIndex}
                      columnCount={columns.length}
                      gridTemplateColumns={gridTemplateColumns}
                      style={rowStyle}
                    />
                  );
                }

                return (
                  <div
                    key={`${queryKey}-${rowIndex}`}
                    style={rowStyle}
                    className={`grid items-center border-b border-gray-200/70 text-sm dark:border-gray-800 ${
                      striped ? "bg-white dark:bg-gray-900" : "bg-gray-50/70 dark:bg-gray-950/70"
                    }`}
                  >
                    <div className="border-r border-gray-200/70 px-4 font-mono text-xs text-gray-400 dark:border-gray-800 dark:text-gray-500">
                      {rowIndex + 1}
                    </div>
                    {columns.map((column) => {
                      const rawValue = row[column.name];
                      const displayValue = formatCellValue(rawValue, column.type);
                      const isNull = rawValue === null || rawValue === undefined;
                      const isNumber = column.type === "number";
                      const isBoolean = column.type === "boolean";

                      return (
                        <div
                          key={`${rowIndex}-${column.name}`}
                          className={`border-r border-gray-200/70 px-4 dark:border-gray-800 ${isNumber ? "text-right" : ""}`}
                          title={String(rawValue ?? "null")}
                        >
                          {isBoolean && !isNull ? (
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                                displayValue === "true"
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                                  : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
                              }`}
                            >
                              {displayValue}
                            </span>
                          ) : (
                            <span
                              className={`block truncate ${isNull ? "italic text-gray-400 dark:text-gray-500" : "text-gray-900 dark:text-white"} ${
                                isNumber ? "font-mono tabular-nums" : ""
                              }`}
                            >
                              {displayValue}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </motion.section>
  );
}
