"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type MouseEvent as ReactMouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Search,
  Pin,
  X,
  Check,
  Hash,
  Type,
  Calendar,
  ToggleLeft,
  HelpCircle,
  Loader2,
  Grid3X3,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VirtualDataGridProps {
  tableName: string;
  columns: ColumnProfile[];
  totalRows: number;
}

type SortDirection = "asc" | "desc" | null;

interface SortState {
  column: string | null;
  direction: SortDirection;
}

interface CellAddress {
  row: number;
  col: number;
}

const PAGE_SIZE = 100;
const ROW_HEIGHT = 32;
const OVERSCAN = 5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const typeColorMap: Record<string, { bg: string; text: string; icon: typeof Hash }> = {
  number:  { bg: "bg-blue-50 dark:bg-blue-950/50",    text: "text-blue-600 dark:text-blue-400",    icon: Hash },
  string:  { bg: "bg-emerald-50 dark:bg-emerald-950/50", text: "text-emerald-600 dark:text-emerald-400", icon: Type },
  date:    { bg: "bg-amber-50 dark:bg-amber-950/50",  text: "text-amber-600 dark:text-amber-400",  icon: Calendar },
  boolean: { bg: "bg-purple-50 dark:bg-purple-950/50", text: "text-purple-600 dark:text-purple-400", icon: ToggleLeft },
  unknown: { bg: "bg-gray-100 dark:bg-gray-800",      text: "text-gray-500 dark:text-gray-400",    icon: HelpCircle },
};

function formatCellValue(value: unknown, type: string): string {
  if (value === null || value === undefined) return "null";
  if (type === "number") {
    const n = typeof value === "number" ? value : Number(value);
    if (isNaN(n)) return String(value);
    return formatNumber(n);
  }
  if (type === "boolean") {
    return String(value);
  }
  if (type === "date") {
    const d = new Date(String(value));
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  return String(value);
}

function isNullish(value: unknown): boolean {
  return value === null || value === undefined;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function VirtualDataGrid({
  tableName,
  columns,
  totalRows,
}: VirtualDataGridProps) {
  // ---- State ----
  const [sort, setSort] = useState<SortState>({ column: null, direction: null });
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filteredRowCount, setFilteredRowCount] = useState(totalRows);
  const [pinnedCount, setPinnedCount] = useState(0);
  const [selectedCell, setSelectedCell] = useState<CellAddress | null>(null);
  const [copiedNotice, setCopiedNotice] = useState(false);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});

  // Page cache: page index -> rows
  const pageCache = useRef<Map<string, Record<string, unknown>[]>>(new Map());
  const [loadingPages, setLoadingPages] = useState<Set<number>>(new Set());
  const [scrollTop, setScrollTop] = useState(0);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef<{ col: string; startX: number; startWidth: number } | null>(null);

  // Column names for easy access
  const colNames = useMemo(() => columns.map((c) => c.name), [columns]);
  const colTypeMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of columns) m[c.name] = c.type;
    return m;
  }, [columns]);

  // ---- Debounce search ----
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(id);
  }, [searchTerm]);

  // ---- Build cache key from sort + search ----
  const queryFingerprint = useMemo(
    () => `${sort.column}|${sort.direction}|${debouncedSearch}`,
    [sort, debouncedSearch],
  );

  // Clear cache when query params change
  useEffect(() => {
    pageCache.current.clear();
    setScrollTop(0);
    scrollContainerRef.current?.scrollTo({ top: 0 });
  }, [queryFingerprint]);

  // ---- Count filtered rows when search changes ----
  useEffect(() => {
    if (!debouncedSearch.trim()) {
      setFilteredRowCount(totalRows);
      return;
    }
    let cancelled = false;
    const whereClauses = colNames.map(
      (col) => `CAST("${col}" AS VARCHAR) ILIKE '%' || $1 || '%'`,
    );
    const countSql = `SELECT COUNT(*) AS cnt FROM "${tableName}" WHERE ${whereClauses.join(" OR ")}`;
    runQuery(countSql.replace(/\$1/g, `'${debouncedSearch.replace(/'/g, "''")}'`))
      .then((rows) => {
        if (!cancelled) setFilteredRowCount(Number(rows[0]?.cnt ?? 0));
      })
      .catch(() => {
        if (!cancelled) setFilteredRowCount(0);
      });
    return () => { cancelled = true; };
  }, [debouncedSearch, tableName, colNames, totalRows]);

  // ---- Virtual scroll math ----
  const containerHeight = scrollContainerRef.current?.clientHeight ?? 600;
  const effectiveRowCount = filteredRowCount;
  const totalHeight = effectiveRowCount * ROW_HEIGHT;
  const firstVisibleRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const lastVisibleRow = Math.min(
    effectiveRowCount - 1,
    Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN,
  );

  // ---- Determine which pages are needed ----
  const neededPages = useMemo(() => {
    const pages = new Set<number>();
    for (let r = firstVisibleRow; r <= lastVisibleRow; r++) {
      pages.add(Math.floor(r / PAGE_SIZE));
    }
    return pages;
  }, [firstVisibleRow, lastVisibleRow]);

  // ---- Build SQL for fetching a page ----
  const buildPageQuery = useCallback(
    (pageIdx: number): string => {
      const offset = pageIdx * PAGE_SIZE;
      const selectCols = colNames.map((c) => `"${c}"`).join(", ");
      let sql = `SELECT ${selectCols} FROM "${tableName}"`;

      if (debouncedSearch.trim()) {
        const escaped = debouncedSearch.replace(/'/g, "''");
        const whereClauses = colNames.map(
          (col) => `CAST("${col}" AS VARCHAR) ILIKE '%${escaped}%'`,
        );
        sql += ` WHERE ${whereClauses.join(" OR ")}`;
      }

      if (sort.column && sort.direction) {
        sql += ` ORDER BY "${sort.column}" ${sort.direction === "asc" ? "ASC" : "DESC"} NULLS LAST`;
      }

      sql += ` LIMIT ${PAGE_SIZE} OFFSET ${offset}`;
      return sql;
    },
    [colNames, tableName, debouncedSearch, sort],
  );

  // ---- Fetch pages on demand ----
  useEffect(() => {
    for (const pageIdx of neededPages) {
      const cacheKey = `${queryFingerprint}|${pageIdx}`;
      if (pageCache.current.has(cacheKey) || loadingPages.has(pageIdx)) continue;

      setLoadingPages((prev) => new Set(prev).add(pageIdx));
      const sql = buildPageQuery(pageIdx);

      runQuery(sql)
        .then((rows) => {
          pageCache.current.set(cacheKey, rows);
        })
        .catch(() => {
          pageCache.current.set(cacheKey, []);
        })
        .finally(() => {
          setLoadingPages((prev) => {
            const next = new Set(prev);
            next.delete(pageIdx);
            return next;
          });
        });
    }
  }, [neededPages, queryFingerprint, buildPageQuery, loadingPages]);

  // ---- Get row data from cache ----
  const getRow = useCallback(
    (rowIdx: number): Record<string, unknown> | null => {
      const pageIdx = Math.floor(rowIdx / PAGE_SIZE);
      const cacheKey = `${queryFingerprint}|${pageIdx}`;
      const page = pageCache.current.get(cacheKey);
      if (!page) return null;
      return page[rowIdx % PAGE_SIZE] ?? null;
    },
    [queryFingerprint],
  );

  // ---- Scroll handler ----
  const handleScroll = useCallback(() => {
    if (scrollContainerRef.current) {
      setScrollTop(scrollContainerRef.current.scrollTop);
    }
  }, []);

  // ---- Sort handler ----
  const handleSort = useCallback((colName: string) => {
    setSort((prev) => {
      if (prev.column !== colName) return { column: colName, direction: "asc" };
      if (prev.direction === "asc") return { column: colName, direction: "desc" };
      return { column: null, direction: null };
    });
  }, []);

  // ---- Pin columns ----
  const handleTogglePin = useCallback(
    (colIdx: number) => {
      if (colIdx < pinnedCount) {
        setPinnedCount(colIdx);
      } else {
        setPinnedCount(colIdx + 1);
      }
    },
    [pinnedCount],
  );

  // ---- Column resizing ----
  const handleResizeStart = useCallback(
    (e: ReactMouseEvent, col: string) => {
      e.preventDefault();
      e.stopPropagation();
      const th = (e.target as HTMLElement).closest("th");
      const startWidth = columnWidths[col] ?? th?.offsetWidth ?? 150;
      resizingRef.current = { col, startX: e.clientX, startWidth };

      const onMove = (ev: globalThis.MouseEvent) => {
        if (!resizingRef.current) return;
        const diff = ev.clientX - resizingRef.current.startX;
        const newWidth = Math.max(80, resizingRef.current.startWidth + diff);
        setColumnWidths((prev) => ({ ...prev, [resizingRef.current!.col]: newWidth }));
      };
      const onUp = () => {
        resizingRef.current = null;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [columnWidths],
  );

  // ---- Cell selection ----
  const handleCellClick = useCallback((row: number, col: number) => {
    setSelectedCell({ row, col });
  }, []);

  // ---- Keyboard navigation & copy ----
  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!selectedCell) return;

      const { row, col } = selectedCell;
      let nextRow = row;
      let nextCol = col;

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          nextRow = Math.max(0, row - 1);
          break;
        case "ArrowDown":
          e.preventDefault();
          nextRow = Math.min(effectiveRowCount - 1, row + 1);
          break;
        case "ArrowLeft":
          e.preventDefault();
          nextCol = Math.max(0, col - 1);
          break;
        case "ArrowRight":
          e.preventDefault();
          nextCol = Math.min(colNames.length - 1, col + 1);
          break;
        case "c":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const rowData = getRow(row);
            if (rowData) {
              const colName = colNames[col];
              const value = rowData[colName];
              const text = isNullish(value) ? "" : String(value);
              navigator.clipboard.writeText(text);
              setCopiedNotice(true);
              setTimeout(() => setCopiedNotice(false), 1200);
            }
          }
          return;
        default:
          return;
      }

      setSelectedCell({ row: nextRow, col: nextCol });

      // Scroll into view if needed
      const targetTop = nextRow * ROW_HEIGHT;
      const container = scrollContainerRef.current;
      if (container) {
        if (targetTop < container.scrollTop) {
          container.scrollTop = targetTop;
        } else if (targetTop + ROW_HEIGHT > container.scrollTop + container.clientHeight) {
          container.scrollTop = targetTop + ROW_HEIGHT - container.clientHeight;
        }
      }
    },
    [selectedCell, effectiveRowCount, colNames, getRow],
  );

  // ---- Visible rows to render ----
  const visibleRows = useMemo(() => {
    const rows: number[] = [];
    for (let i = firstVisibleRow; i <= lastVisibleRow; i++) {
      rows.push(i);
    }
    return rows;
  }, [firstVisibleRow, lastVisibleRow]);

  // ---- Pinned / scrollable column split ----
  const pinnedCols = colNames.slice(0, pinnedCount);
  const scrollableCols = colNames.slice(pinnedCount);

  // ---- Shared row renderer ----
  const renderRow = (rowIdx: number, cols: string[], showRowNum: boolean) => {
    const rowData = getRow(rowIdx);
    return (
      <div
        key={rowIdx}
        className={`flex items-center border-b border-gray-100 dark:border-gray-800/50 ${
          rowIdx % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-gray-50/40 dark:bg-gray-800/20"
        }`}
        style={{ position: "absolute", top: rowIdx * ROW_HEIGHT, height: ROW_HEIGHT, left: 0, right: 0 }}
      >
        {showRowNum && (
          <div className="px-3 w-14 flex-shrink-0 text-[11px] text-gray-300 dark:text-gray-600 font-mono tabular-nums">
            {rowIdx + 1}
          </div>
        )}
        {cols.map((col) => {
          const globalIdx = colNames.indexOf(col);
          if (!rowData) {
            return (
              <div key={col} className="px-3 flex-shrink-0" style={{ width: columnWidths[col] ?? 150, minWidth: 80 }}>
                <div className="h-3 rounded bg-gray-200/70 dark:bg-gray-800/70 animate-pulse" />
              </div>
            );
          }
          return (
            <DataCell
              key={col}
              value={rowData[col]}
              type={colTypeMap[col]}
              width={columnWidths[col]}
              isSelected={selectedCell?.row === rowIdx && selectedCell?.col === globalIdx}
              onClick={() => handleCellClick(rowIdx, globalIdx)}
            />
          );
        })}
      </div>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="w-full"
    >
      <div
        className="rounded-xl border border-gray-200/60 dark:border-gray-700/60 bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm overflow-hidden shadow-sm flex flex-col"
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="grid"
      >
        {/* ---- Toolbar ---- */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 px-4 py-2.5 border-b border-gray-200/60 dark:border-gray-700/60 bg-gray-50/60 dark:bg-gray-800/40">
          <div className="flex items-center gap-2 min-w-0">
            <Grid3X3 className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 truncate">
              {tableName}
            </span>
            <span className="text-[11px] font-medium text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700/60 rounded-full px-2 py-0.5 whitespace-nowrap">
              {totalRows.toLocaleString()} rows &middot; {columns.length} cols
            </span>
            {loadingPages.size > 0 && (
              <Loader2 className="w-3.5 h-3.5 text-purple-500 animate-spin" />
            )}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            {/* Search */}
            <div className="relative flex-1 sm:flex-initial">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-gray-500 pointer-events-none" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search all columns..."
                className="w-full sm:w-56 pl-8 pr-7 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-purple-500 transition-shadow"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Copy notice */}
            <AnimatePresence>
              {copiedNotice && (
                <motion.span
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400"
                >
                  <Check className="w-3 h-3" /> Copied
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* ---- Filtered row count ---- */}
        <AnimatePresence>
          {debouncedSearch.trim() && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="px-4 py-1.5 text-[11px] text-gray-400 dark:text-gray-500 bg-purple-50/40 dark:bg-purple-900/10 border-b border-gray-200/40 dark:border-gray-700/40">
                Found{" "}
                <span className="font-semibold text-purple-600 dark:text-purple-400">
                  {filteredRowCount.toLocaleString()}
                </span>{" "}
                matching {filteredRowCount === 1 ? "row" : "rows"}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ---- Grid ---- */}
        <div className="flex flex-1 overflow-hidden" style={{ height: 600 }}>
          {/* Pinned columns panel */}
          {pinnedCount > 0 && (
            <div className="flex-shrink-0 border-r-2 border-purple-200 dark:border-purple-800/60 overflow-hidden bg-white dark:bg-gray-900">
              {/* Pinned header */}
              <div className="sticky top-0 z-20 bg-gray-50/95 dark:bg-gray-800/95 backdrop-blur-sm border-b border-gray-200/60 dark:border-gray-700/60">
                <table className="border-collapse">
                  <thead>
                    <tr style={{ height: ROW_HEIGHT + 8 }}>
                      {/* Row number header */}
                      <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-400 dark:text-gray-500 w-14 select-none">
                        #
                      </th>
                      {pinnedCols.map((col, ci) => (
                        <HeaderCell
                          key={col}
                          col={col}
                          colIdx={ci}
                          type={colTypeMap[col]}
                          sort={sort}
                          isPinned={true}
                          columnWidth={columnWidths[col]}
                          onSort={handleSort}
                          onTogglePin={handleTogglePin}
                          onResizeStart={handleResizeStart}
                        />
                      ))}
                    </tr>
                  </thead>
                </table>
              </div>

              {/* Pinned body */}
              <div className="overflow-hidden" style={{ height: `calc(100% - ${ROW_HEIGHT + 8}px)` }}>
                <div style={{ height: totalHeight, position: "relative" }}>
                  {visibleRows.map((rowIdx) => renderRow(rowIdx, pinnedCols, true))}
                </div>
              </div>
            </div>
          )}

          {/* Scrollable area */}
          <div
            ref={scrollContainerRef}
            className="flex-1 overflow-auto"
            onScroll={handleScroll}
          >
            {/* Header */}
            <div className="sticky top-0 z-10 bg-gray-50/95 dark:bg-gray-800/95 backdrop-blur-sm border-b border-gray-200/60 dark:border-gray-700/60">
              <table className="w-full border-collapse">
                <thead>
                  <tr style={{ height: ROW_HEIGHT + 8 }}>
                    {pinnedCount === 0 && (
                      <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-400 dark:text-gray-500 w-14 select-none">
                        #
                      </th>
                    )}
                    {scrollableCols.map((col) => {
                      const globalIdx = colNames.indexOf(col);
                      return (
                        <HeaderCell
                          key={col}
                          col={col}
                          colIdx={globalIdx}
                          type={colTypeMap[col]}
                          sort={sort}
                          isPinned={false}
                          columnWidth={columnWidths[col]}
                          onSort={handleSort}
                          onTogglePin={handleTogglePin}
                          onResizeStart={handleResizeStart}
                        />
                      );
                    })}
                  </tr>
                </thead>
              </table>
            </div>

            {/* Body */}
            <div style={{ height: totalHeight, position: "relative" }}>
              {visibleRows.map((rowIdx) => renderRow(rowIdx, scrollableCols, pinnedCount === 0))}
            </div>
          </div>
        </div>

        {/* ---- Footer ---- */}
        <div className="flex items-center justify-between px-4 py-2 bg-gray-50/80 dark:bg-gray-800/60 border-t border-gray-200/60 dark:border-gray-700/60 text-xs text-gray-400 dark:text-gray-500">
          <div className="flex items-center gap-3">
            <span>{effectiveRowCount.toLocaleString()} rows</span>
            {pinnedCount > 0 && (
              <span className="flex items-center gap-1 text-purple-500 dark:text-purple-400">
                <Pin className="w-3 h-3" />
                {pinnedCount} pinned
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-300 dark:text-gray-600">
              Arrow keys to navigate &middot; Ctrl+C to copy
            </span>
            {selectedCell && (
              <span className="font-mono text-[11px] text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700/60 rounded px-1.5 py-0.5">
                R{selectedCell.row + 1}:C{selectedCell.col + 1}
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function HeaderCell({
  col,
  colIdx,
  type,
  sort,
  isPinned,
  columnWidth,
  onSort,
  onTogglePin,
  onResizeStart,
}: {
  col: string;
  colIdx: number;
  type: string;
  sort: SortState;
  isPinned: boolean;
  columnWidth: number | undefined;
  onSort: (col: string) => void;
  onTogglePin: (colIdx: number) => void;
  onResizeStart: (e: ReactMouseEvent, col: string) => void;
}) {
  const typeInfo = typeColorMap[type] || typeColorMap.unknown;
  const TypeIcon = typeInfo.icon;

  return (
    <th
      className="px-3 py-2 text-left text-[11px] font-medium text-gray-500 dark:text-gray-400 select-none group relative"
      style={columnWidth ? { width: columnWidth, minWidth: 80 } : { minWidth: 80 }}
    >
      <div className="flex items-center gap-1.5">
        {/* Type badge */}
        <span
          className={`inline-flex items-center justify-center w-4 h-4 rounded ${typeInfo.bg}`}
          title={type}
        >
          <TypeIcon className={`w-2.5 h-2.5 ${typeInfo.text}`} />
        </span>

        {/* Column name (sortable) */}
        <button
          onClick={() => onSort(col)}
          className={`truncate font-medium hover:text-gray-700 dark:hover:text-gray-200 transition-colors ${
            type === "number" ? "text-right" : ""
          }`}
        >
          {col}
        </button>

        {/* Sort indicator */}
        {sort.column === col ? (
          sort.direction === "asc" ? (
            <ArrowUp className="w-3 h-3 text-purple-500 flex-shrink-0" />
          ) : (
            <ArrowDown className="w-3 h-3 text-purple-500 flex-shrink-0" />
          )
        ) : (
          <ArrowUpDown className="w-3 h-3 text-gray-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
        )}

        {/* Pin toggle */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin(colIdx);
          }}
          title={isPinned ? "Unpin column" : "Pin column"}
          className={`p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity ${
            isPinned
              ? "text-purple-500 dark:text-purple-400 opacity-100"
              : "text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400"
          }`}
        >
          <Pin className="w-3 h-3" />
        </button>
      </div>

      {/* Resize handle */}
      <div
        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-purple-400/30 active:bg-purple-400/50 transition-colors"
        onMouseDown={(e) => onResizeStart(e, col)}
      />
    </th>
  );
}

function DataCell({
  value,
  type,
  width,
  isSelected,
  onClick,
}: {
  value: unknown;
  type: string;
  width: number | undefined;
  isSelected: boolean;
  onClick: () => void;
}) {
  const isNull = isNullish(value);
  const display = formatCellValue(value, type);

  return (
    <div
      className={`px-3 flex-shrink-0 font-mono text-xs truncate cursor-pointer transition-colors ${
        isSelected
          ? "bg-purple-100 dark:bg-purple-900/30 ring-1 ring-inset ring-purple-400 dark:ring-purple-600 rounded-sm"
          : "hover:bg-purple-50/50 dark:hover:bg-purple-900/10"
      } ${
        isNull
          ? "text-gray-300 dark:text-gray-600 italic"
          : type === "number"
            ? "text-right tabular-nums text-gray-700 dark:text-gray-300"
            : "text-gray-700 dark:text-gray-300"
      }`}
      style={{
        width: width ?? 150,
        minWidth: 80,
        lineHeight: `${ROW_HEIGHT}px`,
      }}
      onClick={onClick}
      title={isNull ? "null" : String(value)}
    >
      {display}
    </div>
  );
}
