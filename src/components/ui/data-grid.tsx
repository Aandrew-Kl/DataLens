"use client";

import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type UIEvent,
} from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, GripVertical } from "lucide-react";

export type DataGridRow = Record<string, unknown>;

export interface DataGridColumn {
  key: string;
  label: string;
  width?: number;
  minWidth?: number;
  align?: "left" | "center" | "right";
  sortable?: boolean;
  formatter?: (value: unknown, row: DataGridRow) => ReactNode;
}

export interface DataGridProps {
  columns: DataGridColumn[];
  rows: DataGridRow[];
  height?: number;
  rowHeight?: number;
  overscan?: number;
}

interface SortState {
  key: string | null;
  direction: "asc" | "desc" | null;
}

interface ActiveCell {
  rowIndex: number;
  columnIndex: number;
}

interface ResizeState {
  key: string;
  startX: number;
  startWidth: number;
}

const GLASS_PANEL =
  "bg-white/75 backdrop-blur-2xl dark:bg-slate-950/45 border border-white/20";
const DEFAULT_HEIGHT = 460;
const DEFAULT_ROW_HEIGHT = 44;
const DEFAULT_OVERSCAN = 8;

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toLocaleString() : String(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return String(value);
}

function compareUnknown(a: unknown, b: unknown): number {
  if (a === b) {
    return 0;
  }

  if (a === null || a === undefined) {
    return 1;
  }

  if (b === null || b === undefined) {
    return -1;
  }

  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }

  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

function alignClass(align: DataGridColumn["align"]): string {
  if (align === "right") {
    return "text-right";
  }

  if (align === "center") {
    return "text-center";
  }

  return "text-left";
}

export default function DataGrid({
  columns,
  rows,
  height = DEFAULT_HEIGHT,
  rowHeight = DEFAULT_ROW_HEIGHT,
  overscan = DEFAULT_OVERSCAN,
}: DataGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [sort, setSort] = useState<SortState>({ key: null, direction: null });
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null);
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      columns.map((column) => [column.key, column.width ?? Math.max(160, column.label.length * 14)]),
    ),
  );

  const deferredFilters = useDeferredValue(filters);
  const filteredRows = useMemo(() => {
    const activeFilters = Object.entries(deferredFilters).filter(
      ([, value]) => value.trim().length > 0,
    );

    if (activeFilters.length === 0) {
      return rows;
    }

    return rows.filter((row) =>
      activeFilters.every(([key, value]) =>
        String(row[key] ?? "")
          .toLowerCase()
          .includes(value.trim().toLowerCase()),
      ),
    );
  }, [deferredFilters, rows]);

  const sortedRows = useMemo(() => {
    if (!sort.key || !sort.direction) {
      return filteredRows;
    }

    const nextRows = [...filteredRows];
    nextRows.sort((left, right) => {
      const result = compareUnknown(left[sort.key ?? ""], right[sort.key ?? ""]);
      return sort.direction === "asc" ? result : -result;
    });
    return nextRows;
  }, [filteredRows, sort.direction, sort.key]);

  const visibleRange = useMemo(() => {
    const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const visibleCount = Math.ceil(height / rowHeight) + overscan * 2;
    const endIndex = Math.min(sortedRows.length, startIndex + visibleCount);
    return { startIndex, endIndex };
  }, [height, overscan, rowHeight, scrollTop, sortedRows.length]);

  const visibleRows = useMemo(
    () => sortedRows.slice(visibleRange.startIndex, visibleRange.endIndex),
    [sortedRows, visibleRange.endIndex, visibleRange.startIndex],
  );
  const totalHeight = sortedRows.length * rowHeight;
  const paddingTop = visibleRange.startIndex * rowHeight;
  const paddingBottom = Math.max(
    0,
    totalHeight - paddingTop - visibleRows.length * rowHeight,
  );

  const applyResize = useEffectEvent((event: MouseEvent) => {
    if (!resizeState) {
      return;
    }

    const nextWidth = Math.max(
      columns.find((column) => column.key === resizeState.key)?.minWidth ?? 120,
      resizeState.startWidth + event.clientX - resizeState.startX,
    );

    startTransition(() => {
      setColumnWidths((current) => ({ ...current, [resizeState.key]: nextWidth }));
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
  }, [applyResize, resizeState, stopResize]);

  useEffect(() => {
    if (!containerRef.current || !activeCell) {
      return;
    }

    const top = activeCell.rowIndex * rowHeight;
    const bottom = top + rowHeight;
    const viewTop = containerRef.current.scrollTop;
    const viewBottom = viewTop + height;

    if (top < viewTop) {
      containerRef.current.scrollTop = top;
    } else if (bottom > viewBottom) {
      containerRef.current.scrollTop = bottom - height;
    }
  }, [activeCell, height, rowHeight]);

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    setScrollTop(event.currentTarget.scrollTop);
  }

  function toggleSort(column: DataGridColumn) {
    if (column.sortable === false) {
      return;
    }

    startTransition(() => {
      setSort((current) => {
        if (current.key !== column.key) {
          return { key: column.key, direction: "asc" };
        }

        if (current.direction === "asc") {
          return { key: column.key, direction: "desc" };
        }

        if (current.direction === "desc") {
          return { key: null, direction: null };
        }

        return { key: column.key, direction: "asc" };
      });
    });
  }

  function updateFilter(columnKey: string, value: string) {
    startTransition(() => {
      setFilters((current) => ({ ...current, [columnKey]: value }));
      setSelectedRowIndex(null);
      setActiveCell(null);
    });
  }

  function startResize(column: DataGridColumn, clientX: number) {
    setResizeState({
      key: column.key,
      startX: clientX,
      startWidth: columnWidths[column.key] ?? column.width ?? 160,
    });
  }

  function handleGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (sortedRows.length === 0 || columns.length === 0) {
      return;
    }

    const currentCell = activeCell ?? { rowIndex: 0, columnIndex: 0 };
    let nextCell = currentCell;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      nextCell = {
        rowIndex: Math.min(sortedRows.length - 1, currentCell.rowIndex + 1),
        columnIndex: currentCell.columnIndex,
      };
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      nextCell = {
        rowIndex: Math.max(0, currentCell.rowIndex - 1),
        columnIndex: currentCell.columnIndex,
      };
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      nextCell = {
        rowIndex: currentCell.rowIndex,
        columnIndex: Math.min(columns.length - 1, currentCell.columnIndex + 1),
      };
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      nextCell = {
        rowIndex: currentCell.rowIndex,
        columnIndex: Math.max(0, currentCell.columnIndex - 1),
      };
    } else if (event.key === "Home") {
      event.preventDefault();
      nextCell = { rowIndex: 0, columnIndex: 0 };
    } else if (event.key === "End") {
      event.preventDefault();
      nextCell = { rowIndex: sortedRows.length - 1, columnIndex: columns.length - 1 };
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      setSelectedRowIndex(currentCell.rowIndex);
      return;
    } else {
      return;
    }

    setActiveCell(nextCell);
    setSelectedRowIndex(nextCell.rowIndex);
  }

  function renderCell(
    column: DataGridColumn,
    row: DataGridRow,
    rowIndex: number,
    columnIndex: number,
  ) {
    const value = row[column.key];
    const content = column.formatter
      ? column.formatter(value, row)
      : formatValue(value);
    const isActive =
      activeCell?.rowIndex === rowIndex && activeCell.columnIndex === columnIndex;

    return (
      <div
        key={column.key}
        role="gridcell"
        className={`truncate border-r border-white/10 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 ${alignClass(column.align)} ${
          isActive ? "bg-sky-500/10 ring-1 ring-inset ring-sky-500/30" : ""
        }`}
      >
        {content}
      </div>
    );
  }

  const gridTemplateColumns = columns
    .map((column) => `${columnWidths[column.key] ?? column.width ?? 160}px`)
    .join(" ");

  return (
    <section className={`overflow-hidden rounded-[2rem] ${GLASS_PANEL}`}>
      <div className="border-b border-white/15 px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">
              Data grid
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Virtualized rows, sticky headers, per-column filters, and keyboard
              selection.
            </p>
          </div>
          <div className="rounded-full bg-white/70 px-3 py-1 text-xs font-medium text-slate-600 dark:bg-slate-900/60 dark:text-slate-300">
            {sortedRows.length.toLocaleString()} rows
          </div>
        </div>
      </div>

      <div
        ref={containerRef}
        role="grid"
        tabIndex={0}
        aria-label="Virtualized data grid"
        className="overflow-auto outline-none"
        style={{ height }}
        onScroll={handleScroll}
        onKeyDown={handleGridKeyDown}
      >
        <div
          className="sticky top-0 z-10 border-b border-white/15 bg-white/90 backdrop-blur-2xl dark:bg-slate-950/85"
          style={{ minWidth: gridTemplateColumns }}
        >
          <div
            role="row"
            className="grid"
            style={{ gridTemplateColumns }}
          >
            {columns.map((column) => {
              const isSorted = sort.key === column.key;

              return (
                <div
                  key={column.key}
                  role="columnheader"
                  className="relative border-r border-white/10 px-3 py-3"
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(column)}
                    className="flex w-full items-center justify-between gap-2 text-left text-sm font-semibold text-slate-900 dark:text-slate-100"
                  >
                    <span className="truncate">{column.label}</span>
                    {isSorted ? (
                      sort.direction === "desc" ? (
                        <ArrowDown className="h-4 w-4 shrink-0 text-sky-600" />
                      ) : (
                        <ArrowUp className="h-4 w-4 shrink-0 text-sky-600" />
                      )
                    ) : (
                      <ArrowUpDown className="h-4 w-4 shrink-0 text-slate-400" />
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label={`Resize ${column.label}`}
                    onMouseDown={(event) => startResize(column, event.clientX)}
                    className="absolute inset-y-0 right-0 flex w-4 items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-100"
                  >
                    <GripVertical className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="grid border-t border-white/10" style={{ gridTemplateColumns }}>
            {columns.map((column) => (
              <label key={column.key} className="border-r border-white/10 px-2 py-2">
                <span className="sr-only">Filter {column.label}</span>
                <input
                  value={filters[column.key] ?? ""}
                  onChange={(event) => updateFilter(column.key, event.target.value)}
                  placeholder="Filter…"
                  aria-label={`Filter ${column.label}`}
                  className="w-full rounded-xl border border-white/15 bg-white/70 px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-sky-400 dark:bg-slate-900/60 dark:text-slate-50"
                />
              </label>
            ))}
          </div>
        </div>

        <div style={{ paddingTop, paddingBottom }}>
          {visibleRows.length > 0 ? (
            visibleRows.map((row, visibleIndex) => {
              const rowIndex = visibleRange.startIndex + visibleIndex;
              const rowStyle: CSSProperties = { gridTemplateColumns };
              const isSelected = selectedRowIndex === rowIndex;

              return (
                <div
                  key={`${rowIndex}-${String(row[columns[0]?.key ?? ""])}`}
                  role="row"
                  aria-selected={isSelected}
                  className={`grid border-b border-white/10 transition ${
                    isSelected
                      ? "bg-sky-500/10"
                      : rowIndex % 2 === 0
                        ? "bg-white/35 dark:bg-slate-950/20"
                        : "bg-white/12 dark:bg-slate-950/10"
                  }`}
                  style={rowStyle}
                  onClick={() => {
                    setSelectedRowIndex(rowIndex);
                    setActiveCell({ rowIndex, columnIndex: 0 });
                  }}
                >
                  {columns.map((column, columnIndex) =>
                    renderCell(column, row, rowIndex, columnIndex),
                  )}
                </div>
              );
            })
          ) : (
            <div className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
              No rows match the current filters.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
