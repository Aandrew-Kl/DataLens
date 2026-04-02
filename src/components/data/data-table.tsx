"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { formatNumber } from "@/lib/utils/formatters";

interface DataTableProps {
  data: Record<string, unknown>[];
  columns: string[];
}

type SortDirection = "asc" | "desc" | null;

interface SortState {
  column: string | null;
  direction: SortDirection;
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "--";
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export default function DataTable({ data, columns }: DataTableProps) {
  const [sort, setSort] = useState<SortState>({ column: null, direction: null });
  const PAGE_SIZE = 100;
  const [visibleRows, setVisibleRows] = useState(PAGE_SIZE);

  const sortedData = useMemo(() => {
    if (!sort.column || !sort.direction) return data;

    return [...data].sort((a, b) => {
      const aVal = a[sort.column!];
      const bVal = b[sort.column!];

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

      return sort.direction === "desc" ? -comparison : comparison;
    });
  }, [data, sort]);

  const displayData = useMemo(
    () => sortedData.slice(0, visibleRows),
    [sortedData, visibleRows]
  );

  const handleSort = (column: string) => {
    setSort((prev) => {
      if (prev.column !== column) return { column, direction: "asc" };
      if (prev.direction === "asc") return { column, direction: "desc" };
      return { column: null, direction: null };
    });
  };

  const SortIcon = ({ column }: { column: string }) => {
    if (sort.column !== column) {
      return <ArrowUpDown className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600" />;
    }
    return sort.direction === "asc" ? (
      <ArrowUp className="w-3.5 h-3.5 text-purple-500" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-purple-500" />
    );
  };

  if (!data.length) {
    return (
      <div className="text-center py-12 text-gray-400 dark:text-gray-500 text-sm">
        No data to display
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="w-full"
    >
      <div className="rounded-xl border border-gray-200/60 dark:border-gray-700/60 overflow-hidden">
        <div className="max-h-[500px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50/90 dark:bg-gray-800/90 backdrop-blur-sm border-b border-gray-200/60 dark:border-gray-700/60">
                <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-400 dark:text-gray-500 w-12">
                  #
                </th>
                {columns.map((col) => (
                  <th
                    key={col}
                    onClick={() => handleSort(col)}
                    className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200 transition-colors group"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="truncate max-w-[180px]">{col}</span>
                      <SortIcon column={col} />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayData.map((row, rowIdx) => (
                <tr
                  key={rowIdx}
                  className={`
                    border-b border-gray-100 dark:border-gray-800/50 transition-colors
                    hover:bg-purple-50/40 dark:hover:bg-purple-900/10
                    ${rowIdx % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-gray-50/50 dark:bg-gray-800/30"}
                  `}
                >
                  <td className="px-3 py-2 text-xs text-gray-300 dark:text-gray-600 font-mono tabular-nums">
                    {rowIdx + 1}
                  </td>
                  {columns.map((col) => (
                    <td
                      key={col}
                      className="px-3 py-2 text-gray-700 dark:text-gray-300 truncate max-w-[260px]"
                      title={String(row[col] ?? "")}
                    >
                      {formatCellValue(row[col])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50/80 dark:bg-gray-800/60 border-t border-gray-200/60 dark:border-gray-700/60 text-xs text-gray-400 dark:text-gray-500">
          <span>
            Showing {displayData.length.toLocaleString()} of{" "}
            {data.length.toLocaleString()} rows
          </span>
          {visibleRows < data.length && (
            <button
              onClick={() => setVisibleRows((v) => v + PAGE_SIZE)}
              className="text-purple-500 hover:text-purple-600 dark:hover:text-purple-400 font-medium transition-colors"
            >
              Load more
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
