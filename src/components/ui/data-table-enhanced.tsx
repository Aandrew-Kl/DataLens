"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  Search,
  Trash2,
} from "lucide-react";

import { clamp } from "@/lib/utils/formatters";

const GLASS_PANEL_CLASS =
  "bg-white/75 backdrop-blur-2xl dark:bg-slate-950/45 border border-white/20";

type SortDirection = "asc" | "desc" | null;

export interface DataTableEnhancedColumn<T> {
  id: string;
  header: string;
  accessor: (row: T) => unknown;
  render?: (value: unknown, row: T) => ReactNode;
  sortable?: boolean;
  filterValue?: (value: unknown, row: T) => string;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  align?: "left" | "center" | "right";
}

export interface DataTableBulkAction<T> {
  label: string;
  onClick: (rows: T[]) => void;
  tone?: "default" | "danger";
}

interface DataTableEnhancedProps<T> {
  data: T[];
  columns: DataTableEnhancedColumn<T>[];
  title?: string;
  initialPageSize?: number;
  pageSizeOptions?: number[];
  rowId?: (row: T, index: number) => string;
  bulkActions?: DataTableBulkAction<T>[];
  onExportSelected?: (rows: T[]) => void;
  emptyMessage?: string;
}

interface IndexedRow<T> {
  id: string;
  index: number;
  original: T;
}

interface ResizeState {
  columnId: string;
  startX: number;
  startWidth: number;
}

function defaultRowId<T>(_row: T, index: number) {
  return `row-${index}`;
}

function valueToText(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return String(value);
  }

  return JSON.stringify(value);
}

function compareValues(left: unknown, right: unknown) {
  if (left === right) {
    return 0;
  }

  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  if (left instanceof Date && right instanceof Date) {
    return left.getTime() - right.getTime();
  }

  return valueToText(left).localeCompare(valueToText(right), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function IndeterminateCheckbox({
  checked,
  indeterminate,
  label,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  label: string;
  onChange: () => void;
}) {
  const checkboxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <input
      ref={checkboxRef}
      type="checkbox"
      checked={checked}
      aria-label={label}
      onChange={onChange}
      className="h-4 w-4 rounded border-white/20 bg-white/70 text-cyan-600 focus:ring-cyan-400 dark:bg-slate-900/60"
    />
  );
}

function HeaderSortIcon({ direction }: { direction: SortDirection }) {
  if (direction === "asc") {
    return <ArrowUp className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />;
  }

  if (direction === "desc") {
    return <ArrowDown className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />;
  }

  return <ArrowUpDown className="h-4 w-4 text-slate-400" />;
}

function BulkToolbar<T>({
  rows,
  actions,
  onExport,
  onClear,
}: {
  rows: T[];
  actions: DataTableBulkAction<T>[];
  onExport: () => void;
  onClear: () => void;
}) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3 ${GLASS_PANEL_CLASS}`}>
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        {rows.length} row{rows.length === 1 ? "" : "s"} selected
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onExport}
          className="inline-flex items-center gap-2 rounded-2xl bg-cyan-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-cyan-500"
        >
          <Download className="h-4 w-4" />
          Export selected
        </button>
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={() => action.onClick(rows)}
            className={`rounded-2xl px-3 py-2 text-sm font-semibold transition-colors ${
              action.tone === "danger"
                ? "bg-rose-500 text-white hover:bg-rose-400"
                : "border border-white/20 bg-white/60 text-slate-700 hover:bg-white dark:bg-slate-900/55 dark:text-slate-100 dark:hover:bg-slate-900"
            }`}
          >
            {action.label}
          </button>
        ))}
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/60 px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-white dark:bg-slate-900/55 dark:text-slate-100 dark:hover:bg-slate-900"
        >
          <Trash2 className="h-4 w-4" />
          Clear selection
        </button>
      </div>
    </div>
  );
}

export default function DataTableEnhanced<T>({
  data,
  columns,
  title = "Data table",
  initialPageSize = 10,
  pageSizeOptions = [10, 25, 50],
  rowId = defaultRowId,
  bulkActions = [],
  onExportSelected,
  emptyMessage = "No rows match the current filters.",
}: DataTableEnhancedProps<T>) {
  const [filterText, setFilterText] = useState("");
  const [sortColumnId, setSortColumnId] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set<string>());
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);
  const deferredFilterText = useDeferredValue(filterText);

  const rows = useMemo<IndexedRow<T>[]>(
    () => data.map((row, index) => ({ id: rowId(row, index), index, original: row })),
    [data, rowId],
  );

  const filteredRows = useMemo(() => {
    if (!deferredFilterText.trim()) {
      return rows;
    }

    const lowerFilter = deferredFilterText.toLowerCase();

    return rows.filter((row) =>
      columns.some((column) => {
        const rawValue = column.accessor(row.original);
        const filterValue = column.filterValue?.(rawValue, row.original) ?? valueToText(rawValue);
        return filterValue.toLowerCase().includes(lowerFilter);
      }),
    );
  }, [columns, deferredFilterText, rows]);

  const sortedRows = useMemo(() => {
    if (!sortColumnId || !sortDirection) {
      return filteredRows;
    }

    const column = columns.find((candidate) => candidate.id === sortColumnId);
    if (!column) {
      return filteredRows;
    }

    const nextRows = [...filteredRows];
    nextRows.sort((left, right) => {
      const comparison = compareValues(column.accessor(left.original), column.accessor(right.original));
      return sortDirection === "asc" ? comparison : -comparison;
    });
    return nextRows;
  }, [columns, filteredRows, sortColumnId, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageRows = sortedRows.slice(pageStart, pageStart + pageSize);

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.has(row.id)).map((row) => row.original),
    [rows, selectedIds],
  );
  const selectedOnPageCount = pageRows.filter((row) => selectedIds.has(row.id)).length;

  const toggleSort = useCallback(
    (column: DataTableEnhancedColumn<T>) => {
      if (column.sortable === false) {
        return;
      }

      setPage(1);

      if (sortColumnId !== column.id) {
        setSortColumnId(column.id);
        setSortDirection("asc");
        return;
      }

      if (sortDirection === "asc") {
        setSortDirection("desc");
        return;
      }

      if (sortDirection === "desc") {
        setSortColumnId(null);
        setSortDirection(null);
        return;
      }

      setSortDirection("asc");
    },
    [sortColumnId, sortDirection],
  );

  const toggleRowSelection = useCallback((rowIdentifier: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(rowIdentifier)) {
        next.delete(rowIdentifier);
      } else {
        next.add(rowIdentifier);
      }
      return next;
    });
  }, []);

  const togglePageSelection = useCallback(() => {
    setSelectedIds((current) => {
      const next = new Set(current);
      const allSelected = pageRows.every((row) => next.has(row.id));

      for (const row of pageRows) {
        if (allSelected) {
          next.delete(row.id);
        } else {
          next.add(row.id);
        }
      }

      return next;
    });
  }, [pageRows]);

  const exportSelectedRows = useCallback(() => {
    if (onExportSelected) {
      onExportSelected(selectedRows);
      return;
    }

    const header = columns.map((column) => column.header).join(",");
    const body = selectedRows
      .map((row) =>
        columns
          .map((column) => valueToText(column.accessor(row)).replaceAll('"', '""'))
          .map((value) => `"${value}"`)
          .join(","),
      )
      .join("\n");
    const csv = `${header}\n${body}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "selected-rows.csv";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, [columns, onExportSelected, selectedRows]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set<string>());
  }, []);

  const handleResizeStart = useCallback(
    (column: DataTableEnhancedColumn<T>, event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      setResizeState({
        columnId: column.id,
        startX: event.clientX,
        startWidth: columnWidths[column.id] ?? column.width ?? 180,
      });
    },
    [columnWidths],
  );

  useEffect(() => {
    if (!resizeState) {
      return;
    }

    const column = columns.find((candidate) => candidate.id === resizeState.columnId);
    if (!column) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const minWidth = column.minWidth ?? 120;
      const maxWidth = column.maxWidth ?? 420;
      const delta = event.clientX - resizeState.startX;
      const nextWidth = clamp(resizeState.startWidth + delta, minWidth, maxWidth);

      setColumnWidths((current) => ({
        ...current,
        [column.id]: nextWidth,
      }));
    };

    const handleMouseUp = () => {
      setResizeState(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [columns, resizeState]);

  return (
    <section className={`space-y-4 rounded-3xl p-4 shadow-sm ${GLASS_PANEL_CLASS}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {filteredRows.length} row{filteredRows.length === 1 ? "" : "s"} after filtering
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="flex items-center gap-2 rounded-2xl border border-white/20 bg-white/60 px-3 py-2 text-sm text-slate-600 dark:bg-slate-900/55 dark:text-slate-300">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={filterText}
              onChange={(event) => {
                setFilterText(event.target.value);
                setPage(1);
              }}
              aria-label="Filter rows"
              placeholder="Filter rows"
              className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100"
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <span>Rows per page</span>
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              aria-label="Rows per page"
              className="rounded-2xl border border-white/20 bg-white/60 px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-900/55 dark:text-slate-100"
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {selectedRows.length ? (
        <BulkToolbar
          rows={selectedRows}
          actions={bulkActions}
          onExport={exportSelectedRows}
          onClear={clearSelection}
        />
      ) : null}

      <div className="overflow-hidden rounded-3xl border border-white/20">
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full table-fixed border-separate border-spacing-0">
            <thead className="sticky top-0 z-10 bg-white/90 backdrop-blur-2xl dark:bg-slate-950/80">
              <tr>
                <th className="w-14 border-b border-white/20 px-4 py-3 text-left">
                  <IndeterminateCheckbox
                    checked={pageRows.length > 0 && selectedOnPageCount === pageRows.length}
                    indeterminate={selectedOnPageCount > 0 && selectedOnPageCount < pageRows.length}
                    label="Select all rows on current page"
                    onChange={togglePageSelection}
                  />
                </th>
                {columns.map((column) => {
                  const width = columnWidths[column.id] ?? column.width ?? 180;
                  const currentDirection = sortColumnId === column.id ? sortDirection : null;

                  return (
                    <th
                      key={column.id}
                      className="border-b border-white/20 px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                      style={{ width }}
                    >
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleSort(column)}
                          className="inline-flex items-center gap-2 text-left"
                        >
                          <span>{column.header}</span>
                          {column.sortable === false ? null : <HeaderSortIcon direction={currentDirection} />}
                        </button>
                        <button
                          type="button"
                          aria-label={`Resize ${column.header} column`}
                          onMouseDown={(event) => handleResizeStart(column, event)}
                          className="ml-auto h-6 w-1 rounded-full bg-slate-200 transition-colors hover:bg-cyan-500 dark:bg-slate-700 dark:hover:bg-cyan-400"
                        />
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {pageRows.length ? (
                pageRows.map((row) => (
                  <tr key={row.id} className="odd:bg-white/35 even:bg-white/10 dark:odd:bg-slate-950/25 dark:even:bg-slate-950/10">
                    <td className="border-b border-white/15 px-4 py-3">
                      <IndeterminateCheckbox
                        checked={selectedIds.has(row.id)}
                        indeterminate={false}
                        label={`Select row ${row.index + 1}`}
                        onChange={() => toggleRowSelection(row.id)}
                      />
                    </td>
                    {columns.map((column) => {
                      const value = column.accessor(row.original);
                      const width = columnWidths[column.id] ?? column.width ?? 180;

                      return (
                        <td
                          key={`${row.id}-${column.id}`}
                          className={`border-b border-white/15 px-4 py-3 text-sm text-slate-700 dark:text-slate-200 ${
                            column.align === "right"
                              ? "text-right"
                              : column.align === "center"
                                ? "text-center"
                                : "text-left"
                          }`}
                          style={{ width }}
                        >
                          {column.render ? column.render(value, row.original) : valueToText(value)}
                        </td>
                      );
                    })}
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={columns.length + 1}
                    className="px-4 py-10 text-center text-sm font-medium text-slate-500 dark:text-slate-400"
                  >
                    {emptyMessage}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-300">
        <p>
          Page {currentPage} of {totalPages}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage(1)}
            disabled={currentPage === 1}
            className="rounded-2xl border border-white/20 bg-white/60 px-3 py-2 font-medium transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-900/55 dark:hover:bg-slate-900"
          >
            First page
          </button>
          <button
            type="button"
            onClick={() => setPage((currentValue) => Math.max(1, currentValue - 1))}
            disabled={currentPage === 1}
            className="rounded-2xl border border-white/20 bg-white/60 px-3 py-2 font-medium transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-900/55 dark:hover:bg-slate-900"
          >
            Previous page
          </button>
          <button
            type="button"
            onClick={() => setPage((currentValue) => Math.min(totalPages, currentValue + 1))}
            disabled={currentPage === totalPages}
            className="rounded-2xl border border-white/20 bg-white/60 px-3 py-2 font-medium transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-900/55 dark:hover:bg-slate-900"
          >
            Next page
          </button>
        </div>
      </div>
    </section>
  );
}
