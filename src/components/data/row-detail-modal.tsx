"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Calendar, Check, ChevronLeft, ChevronRight, CircleHelp, Copy, Hash, Rows3, ToggleLeft, Type, X } from "lucide-react";
import Badge from "@/components/ui/badge";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile, ColumnType } from "@/types/dataset";

interface RowDetailModalProps {
  open: boolean;
  onClose: () => void;
  row: Record<string, unknown>;
  columns: ColumnProfile[];
  onPrevious?: () => void;
  onNext?: () => void;
  hasPrevious?: boolean;
  hasNext?: boolean;
  rowIndex?: number;
  totalRows?: number;
}

const TYPE_ICONS: Record<ColumnType, React.ElementType> = { string: Type, number: Hash, date: Calendar, boolean: ToggleLeft, unknown: CircleHelp };

function formatDateValue(value: unknown): string {
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return String(value);
  const hasTime = typeof value === "string" ? /(?:T|\s)\d{1,2}:\d{2}/.test(value) : parsed.getHours() !== 0 || parsed.getMinutes() !== 0 || parsed.getSeconds() !== 0;
  return parsed.toLocaleString(undefined, hasTime
    ? { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }
    : { year: "numeric", month: "long", day: "numeric" });
}

function stringifyValue(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? formatNumber(value) : String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function renderValue(value: unknown, type: ColumnType) {
  if (value == null) return <Badge variant="default">null</Badge>;
  if (type === "number") {
    const numeric = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numeric)
      ? <span className="font-mono text-sm font-medium text-gray-900 dark:text-gray-100">{formatNumber(numeric)}</span>
      : <span className="break-words text-sm text-gray-700 dark:text-gray-300">{String(value)}</span>;
  }
  if (type === "date") return <span className="break-words text-sm text-gray-700 dark:text-gray-300">{formatDateValue(value)}</span>;
  if (type === "boolean") {
    const bool = typeof value === "boolean" ? value : String(value).toLowerCase() === "true";
    return <Badge variant={bool ? "success" : "danger"}>{bool ? "true" : "false"}</Badge>;
  }
  if (Array.isArray(value) || typeof value === "object") {
    return <pre className="overflow-x-auto rounded-xl bg-gray-950 px-4 py-3 text-xs text-gray-100">{stringifyValue(value)}</pre>;
  }
  return <span className="break-words text-sm text-gray-700 dark:text-gray-300">{String(value)}</span>;
}

export default function RowDetailModal({
  open,
  onClose,
  row,
  columns,
  onPrevious,
  onNext,
  hasPrevious = false,
  hasNext = false,
  rowIndex,
  totalRows,
}: RowDetailModalProps) {
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const orderedColumns = useMemo(() => columns.map((column) => ({ column, value: row[column.name] })), [columns, row]);
  const rowJson = useMemo(() => {
    try {
      return JSON.stringify(row, null, 2) ?? "{}";
    } catch {
      return "{}";
    }
  }, [row]);
  const rowLabel = rowIndex != null && totalRows != null ? `Row ${rowIndex + 1} of ${totalRows}` : "Row details";

  const handleCopyJson = useCallback(async () => {
    await navigator.clipboard.writeText(rowJson);
    setCopied(true);
  }, [rowJson]);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const focusTimeout = window.setTimeout(() => panelRef.current?.querySelector<HTMLButtonElement>("button")?.focus(), 40);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && hasPrevious && onPrevious) {
        event.preventDefault();
        onPrevious();
      }
      if (event.key === "ArrowRight" && hasNext && onNext) {
        event.preventDefault();
        onNext();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", handleKeyDown);
      window.clearTimeout(focusTimeout);
    };
  }, [open, onClose, onPrevious, onNext, hasPrevious, hasNext]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.button className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm" aria-label="Close row details" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="relative z-10 flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-gray-200/70 bg-white/95 shadow-2xl dark:border-gray-800/80 dark:bg-gray-950/95"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-gray-200/80 px-6 py-5 dark:border-gray-800">
              <div className="min-w-0">
                <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 dark:bg-gray-900 dark:text-gray-300">
                  <Rows3 className="h-3.5 w-3.5" />
                  {rowLabel}
                </div>
                <h2 id={titleId} className="text-xl font-semibold text-gray-950 dark:text-gray-50">Record snapshot</h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Inspect every column value for the selected row.</p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyJson}
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-gray-600 dark:hover:bg-gray-800"
                >
                  {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied" : "Copy row JSON"}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close modal"
                  className="rounded-xl p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-gray-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto px-6 py-5">
              <dl className="divide-y divide-gray-200/80 dark:divide-gray-800">
                {orderedColumns.map(({ column, value }) => {
                  const Icon = TYPE_ICONS[column.type];
                  return (
                    <div key={column.name} className="grid gap-3 py-4 md:grid-cols-[220px_minmax(0,1fr)] md:gap-6">
                      <dt className="flex items-start gap-3">
                        <span className="mt-0.5 rounded-lg bg-gray-100 p-2 text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{column.name}</div>
                          <div className="mt-1 text-xs capitalize text-gray-500 dark:text-gray-400">{column.type}</div>
                        </div>
                      </dt>
                      <dd className="min-w-0 text-sm">{renderValue(value, column.type)}</dd>
                    </div>
                  );
                })}
              </dl>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-gray-200/80 px-6 py-4 dark:border-gray-800">
              <span className="text-xs text-gray-500 dark:text-gray-400">{columns.length} field{columns.length === 1 ? "" : "s"}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onPrevious}
                  disabled={!hasPrevious || !onPrevious}
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition enabled:hover:border-gray-300 enabled:hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:enabled:hover:border-gray-600 dark:enabled:hover:bg-gray-800"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </button>
                <button
                  type="button"
                  onClick={onNext}
                  disabled={!hasNext || !onNext}
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition enabled:hover:border-gray-300 enabled:hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:enabled:hover:border-gray-600 dark:enabled:hover:bg-gray-800"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
