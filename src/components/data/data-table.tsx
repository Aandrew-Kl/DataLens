"use client";

import {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
  Download,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  X,
  Table2,
  DatabaseZap,
} from "lucide-react";
import { formatNumber } from "@/lib/utils/formatters";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DataTableProps {
  data: Record<string, unknown>[];
  columns: string[];
  pageSize?: number;
  searchable?: boolean;
  sortable?: boolean;
  exportable?: boolean;
  maxHeight?: string;
  title?: string;
  compact?: boolean;
  onRowClick?: (row: Record<string, unknown>, index: number) => void;
  stickyHeader?: boolean;
  columnTypes?: Record<
    string,
    "string" | "number" | "date" | "boolean" | "unknown"
  >;
}

type SortDirection = "asc" | "desc" | null;

interface SortState {
  column: string | null;
  direction: SortDirection;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inferColumnType(
  data: Record<string, unknown>[],
  column: string,
): "string" | "number" | "date" | "boolean" | "unknown" {
  const sample = data.slice(0, 100);
  let numCount = 0;
  let boolCount = 0;
  let dateCount = 0;
  let total = 0;

  for (const row of sample) {
    const v = row[column];
    if (v === null || v === undefined || v === "") continue;
    total++;
    if (typeof v === "number" || (typeof v === "string" && !isNaN(Number(v)) && v.trim() !== "")) {
      numCount++;
    } else if (typeof v === "boolean" || v === "true" || v === "false") {
      boolCount++;
    } else if (typeof v === "string" && !isNaN(Date.parse(v)) && v.length >= 8) {
      dateCount++;
    }
  }

  if (total === 0) return "unknown";
  const threshold = total * 0.8;
  if (numCount >= threshold) return "number";
  if (boolCount >= threshold) return "boolean";
  if (dateCount >= threshold) return "date";
  return "string";
}

function formatDate(value: unknown): string {
  if (value === null || value === undefined) return "";
  const d = new Date(String(value));
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatCellValue(
  value: unknown,
  type: "string" | "number" | "date" | "boolean" | "unknown",
): { display: string; isNull: boolean } {
  if (value === null || value === undefined) {
    return { display: "null", isNull: true };
  }

  switch (type) {
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      if (isNaN(n)) return { display: String(value), isNull: false };
      return { display: formatNumber(n), isNull: false };
    }
    case "boolean": {
      return { display: "", isNull: false };
    }
    case "date": {
      return { display: formatDate(value), isNull: false };
    }
    default:
      return { display: String(value), isNull: false };
  }
}

function rawCellString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function exportToCsv(
  data: Record<string, unknown>[],
  columns: string[],
  filename: string,
) {
  const escape = (v: string) => {
    if (v.includes(",") || v.includes('"') || v.includes("\n")) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  };

  const header = columns.map(escape).join(",");
  const rows = data.map((row) =>
    columns.map((col) => escape(rawCellString(row[col]))).join(","),
  );
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function copyAsTabSeparated(
  data: Record<string, unknown>[],
  columns: string[],
) {
  const header = columns.join("\t");
  const rows = data.map((row) =>
    columns.map((col) => rawCellString(row[col])).join("\t"),
  );
  const text = [header, ...rows].join("\n");
  navigator.clipboard.writeText(text);
}

// ---------------------------------------------------------------------------
// useDebounce hook
// ---------------------------------------------------------------------------

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function BooleanIcon({ value }: { value: unknown }) {
  const bool =
    typeof value === "boolean"
      ? value
      : String(value).toLowerCase() === "true";
  return bool ? (
    <Check className="w-4 h-4 text-emerald-500" />
  ) : (
    <X className="w-4 h-4 text-red-400" />
  );
}

function SortIcon({
  column,
  sort,
}: {
  column: string;
  sort: SortState;
}) {
  if (sort.column !== column) {
    return (
      <ArrowUpDown className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity" />
    );
  }
  return sort.direction === "asc" ? (
    <ArrowUp className="w-3.5 h-3.5 text-purple-500" />
  ) : (
    <ArrowDown className="w-3.5 h-3.5 text-purple-500" />
  );
}

function CopiedTooltip({ show }: { show: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.span
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          className="absolute -top-7 left-1/2 -translate-x-1/2 px-2 py-0.5 text-[10px] font-medium rounded bg-purple-600 text-white whitespace-nowrap z-50 pointer-events-none"
        >
          Copied!
        </motion.span>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function DataTable({
  data,
  columns,
  pageSize: initialPageSize = 50,
  searchable = true,
  sortable = true,
  exportable = true,
  maxHeight = "600px",
  title,
  compact = false,
  onRowClick,
  stickyHeader = true,
  columnTypes: externalColumnTypes,
}: DataTableProps) {
  // ---- State ----
  const [sort, setSort] = useState<SortState>({
    column: null,
    direction: null,
  });
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearch = useDebounce(searchTerm, 300);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [copiedCell, setCopiedCell] = useState<string | null>(null);
  const [copyAllDone, setCopyAllDone] = useState(false);

  const resizingRef = useRef<{
    col: string;
    startX: number;
    startWidth: number;
  } | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  // ---- Infer column types ----
  const resolvedColumnTypes = useMemo(() => {
    const types: Record<
      string,
      "string" | "number" | "date" | "boolean" | "unknown"
    > = {};
    for (const col of columns) {
      types[col] = externalColumnTypes?.[col] ?? inferColumnType(data, col);
    }
    return types;
  }, [data, columns, externalColumnTypes]);

  // ---- Filter ----
  const filteredData = useMemo(() => {
    if (!debouncedSearch.trim()) return data;
    const lower = debouncedSearch.toLowerCase();
    return data.filter((row) =>
      columns.some((col) => {
        const v = row[col];
        if (v === null || v === undefined) return false;
        return String(v).toLowerCase().includes(lower);
      }),
    );
  }, [data, columns, debouncedSearch]);

  // ---- Sort ----
  const sortedData = useMemo(() => {
    if (!sort.column || !sort.direction) return filteredData;
    const col = sort.column;
    const dir = sort.direction;
    return [...filteredData].sort((a, b) => {
      const aVal = a[col];
      const bVal = b[col];
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      let comparison = 0;
      if (typeof aVal === "number" && typeof bVal === "number") {
        comparison = aVal - bVal;
      } else {
        comparison = String(aVal).localeCompare(String(bVal), undefined, {
          numeric: true,
          sensitivity: "base",
        });
      }
      return dir === "desc" ? -comparison : comparison;
    });
  }, [filteredData, sort]);

  // ---- Pagination ----
  const totalRows = sortedData.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  const pageData = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, safePage, pageSize]);

  const startRow = totalRows === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const endRow = Math.min(safePage * pageSize, totalRows);

  // Reset to page 1 when search changes
  const [prevSearch, setPrevSearch] = useState(debouncedSearch);
  if (debouncedSearch !== prevSearch) {
    setPrevSearch(debouncedSearch);
    setCurrentPage(1);
  }

  // ---- Handlers ----
  const handleSort = useCallback(
    (column: string) => {
      if (!sortable) return;
      setSort((prev) => {
        if (prev.column !== column) return { column, direction: "asc" };
        if (prev.direction === "asc") return { column, direction: "desc" };
        return { column: null, direction: null };
      });
    },
    [sortable],
  );

  const handleCopyCell = useCallback(
    (value: unknown, cellId: string) => {
      const text = rawCellString(value);
      navigator.clipboard.writeText(text);
      setCopiedCell(cellId);
      setTimeout(() => setCopiedCell(null), 1200);
    },
    [],
  );

  const handleCopyAll = useCallback(() => {
    copyAsTabSeparated(sortedData, columns);
    setCopyAllDone(true);
    setTimeout(() => setCopyAllDone(false), 1500);
  }, [sortedData, columns]);

  const handleExportCsv = useCallback(() => {
    const filename = title
      ? `${title.replace(/\s+/g, "_").toLowerCase()}.csv`
      : "data_export.csv";
    exportToCsv(sortedData, columns, filename);
  }, [sortedData, columns, title]);

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

  // ---- Pagination page numbers ----
  const pageNumbers = useMemo(() => {
    const pages: (number | "ellipsis")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (safePage > 3) pages.push("ellipsis");
      const start = Math.max(2, safePage - 1);
      const end = Math.min(totalPages - 1, safePage + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (safePage < totalPages - 2) pages.push("ellipsis");
      pages.push(totalPages);
    }
    return pages;
  }, [totalPages, safePage]);

  // ---- Cell padding ----
  const cellPy = compact ? "py-1" : "py-2";
  const cellPx = "px-3";

  // ---- Empty state ----
  if (!data.length) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500 gap-3"
      >
        <DatabaseZap className="w-10 h-10 text-gray-300 dark:text-gray-600" />
        <p className="text-sm font-medium">No data to display</p>
        <p className="text-xs text-gray-300 dark:text-gray-600">
          Load a dataset to see results here
        </p>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="w-full"
    >
      <div className="rounded-xl border border-gray-200/60 dark:border-gray-700/60 bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm overflow-hidden shadow-sm">
        {/* ---- Toolbar ---- */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 px-4 py-2.5 border-b border-gray-200/60 dark:border-gray-700/60 bg-gray-50/60 dark:bg-gray-800/40">
          <div className="flex items-center gap-2 min-w-0">
            <Table2 className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
            {title && (
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 truncate">
                {title}
              </span>
            )}
            <span className="text-[11px] font-medium text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700/60 rounded-full px-2 py-0.5 whitespace-nowrap">
              {data.length.toLocaleString()} rows &middot;{" "}
              {columns.length} cols
            </span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            {/* Search */}
            {searchable && (
              <div className="relative flex-1 sm:flex-initial">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-gray-500 pointer-events-none" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search..."
                  className="w-full sm:w-48 pl-8 pr-7 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-purple-500 transition-shadow"
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
            )}

            {/* Export buttons */}
            {exportable && (
              <div className="flex items-center gap-1">
                <button
                  onClick={handleExportCsv}
                  title="Export CSV"
                  className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/60 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={handleCopyAll}
                  title="Copy all (tab-separated)"
                  className="relative p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/60 transition-colors"
                >
                  {copyAllDone ? (
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ---- Search result count ---- */}
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
                  {totalRows.toLocaleString()}
                </span>{" "}
                matching {totalRows === 1 ? "row" : "rows"}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ---- Table ---- */}
        <div
          ref={tableRef}
          className="overflow-auto"
          style={{ maxHeight }}
        >
          <table className="w-full text-sm border-collapse">
            <thead
              className={
                stickyHeader ? "sticky top-0 z-10" : ""
              }
            >
              <tr className="bg-gray-50/95 dark:bg-gray-800/95 backdrop-blur-sm border-b border-gray-200/60 dark:border-gray-700/60">
                {/* Row number header */}
                <th
                  className={`${cellPx} ${cellPy} text-left text-[11px] font-medium text-gray-400 dark:text-gray-500 w-12 select-none`}
                >
                  #
                </th>
                {columns.map((col) => (
                  <th
                    key={col}
                    className={`${cellPx} ${cellPy} text-left text-[11px] font-medium text-gray-500 dark:text-gray-400 select-none group relative`}
                    style={
                      columnWidths[col]
                        ? { width: columnWidths[col], minWidth: 80 }
                        : { minWidth: 80 }
                    }
                  >
                    <div
                      className={`flex items-center gap-1.5 ${
                        sortable ? "cursor-pointer" : ""
                      } ${
                        resolvedColumnTypes[col] === "number"
                          ? "justify-end"
                          : ""
                      }`}
                      onClick={() => handleSort(col)}
                    >
                      <span className="truncate">{col}</span>
                      {sortable && (
                        <SortIcon column={col} sort={sort} />
                      )}
                    </div>
                    {/* Resize handle */}
                    <div
                      className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-purple-400/30 active:bg-purple-400/50 transition-colors"
                      onMouseDown={(e) => handleResizeStart(e, col)}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageData.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length + 1}
                    className="text-center py-12 text-gray-400 dark:text-gray-500 text-sm"
                  >
                    No matching rows
                  </td>
                </tr>
              ) : (
                pageData.map((row, rowIdx) => {
                  const absoluteIdx = (safePage - 1) * pageSize + rowIdx;
                  return (
                    <tr
                      key={absoluteIdx}
                      onClick={() => onRowClick?.(row, absoluteIdx)}
                      className={`
                        border-b border-gray-100 dark:border-gray-800/50 transition-colors
                        hover:bg-purple-50/50 dark:hover:bg-purple-900/10
                        ${rowIdx % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-gray-50/40 dark:bg-gray-800/20"}
                        ${onRowClick ? "cursor-pointer" : ""}
                      `}
                    >
                      {/* Row number */}
                      <td
                        className={`${cellPx} ${cellPy} text-[11px] text-gray-300 dark:text-gray-600 font-mono tabular-nums`}
                      >
                        {absoluteIdx + 1}
                      </td>
                      {columns.map((col) => {
                        const value = row[col];
                        const type = resolvedColumnTypes[col];
                        const { display, isNull } = formatCellValue(
                          value,
                          type,
                        );
                        const cellId = `${absoluteIdx}-${col}`;

                        return (
                          <td
                            key={col}
                            className={`${cellPx} ${cellPy} font-mono text-xs relative group/cell max-w-[300px] ${
                              type === "number"
                                ? "text-right tabular-nums"
                                : ""
                            }`}
                            style={
                              columnWidths[col]
                                ? {
                                    width: columnWidths[col],
                                    maxWidth: columnWidths[col],
                                  }
                                : undefined
                            }
                          >
                            <div
                              className={`truncate ${
                                isNull
                                  ? "text-gray-300 dark:text-gray-600 italic"
                                  : "text-gray-700 dark:text-gray-300"
                              } cursor-pointer hover:text-purple-600 dark:hover:text-purple-400 transition-colors`}
                              title={rawCellString(value)}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopyCell(value, cellId);
                              }}
                            >
                              {type === "boolean" ? (
                                <span className="flex items-center justify-center">
                                  <BooleanIcon value={value} />
                                </span>
                              ) : (
                                display
                              )}
                            </div>
                            <CopiedTooltip
                              show={copiedCell === cellId}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ---- Footer / Pagination ---- */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 px-4 py-2.5 bg-gray-50/80 dark:bg-gray-800/60 border-t border-gray-200/60 dark:border-gray-700/60 text-xs text-gray-400 dark:text-gray-500">
          {/* Left: info */}
          <div className="flex items-center gap-3">
            <span>
              {totalRows === 0
                ? "No rows"
                : `Showing ${startRow.toLocaleString()}\u2013${endRow.toLocaleString()} of ${totalRows.toLocaleString()} rows`}
            </span>
            {/* Page size selector */}
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="text-[11px] px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-purple-400"
            >
              {[10, 25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size} / page
                </option>
              ))}
            </select>
          </div>

          {/* Right: page controls */}
          {totalPages > 1 && (
            <div className="flex items-center gap-0.5">
              <button
                disabled={safePage <= 1}
                onClick={() => setCurrentPage(1)}
                className="p-1 rounded hover:bg-gray-200/60 dark:hover:bg-gray-700/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="First page"
              >
                <ChevronsLeft className="w-3.5 h-3.5" />
              </button>
              <button
                disabled={safePage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="p-1 rounded hover:bg-gray-200/60 dark:hover:bg-gray-700/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Previous page"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              {pageNumbers.map((page, i) =>
                page === "ellipsis" ? (
                  <span key={`e-${i}`} className="px-1.5 text-gray-300 dark:text-gray-600">
                    ...
                  </span>
                ) : (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`min-w-[26px] h-[26px] text-[11px] rounded font-medium transition-colors ${
                      page === safePage
                        ? "bg-purple-500 text-white shadow-sm"
                        : "hover:bg-gray-200/60 dark:hover:bg-gray-700/60 text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    {page}
                  </button>
                ),
              )}

              <button
                disabled={safePage >= totalPages}
                onClick={() =>
                  setCurrentPage((p) => Math.min(totalPages, p + 1))
                }
                className="p-1 rounded hover:bg-gray-200/60 dark:hover:bg-gray-700/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Next page"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button
                disabled={safePage >= totalPages}
                onClick={() => setCurrentPage(totalPages)}
                className="p-1 rounded hover:bg-gray-200/60 dark:hover:bg-gray-700/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Last page"
              >
                <ChevronsRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
