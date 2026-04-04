"use client";

import { useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";

import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";
import DataTable from "@/components/data/data-table";

export function ToolSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-base font-semibold text-slate-900 dark:text-white">
          {title}
        </h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}

export function AnimatedWorkspaceSection({
  children,
  className = "space-y-6",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      transition={{ duration: 0.2 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function TablePreview({
  tableName,
  columns,
  onRowsLoaded,
  onRowClick,
}: {
  tableName: string;
  columns: ColumnProfile[];
  onRowsLoaded?: (rows: Record<string, unknown>[]) => void;
  onRowClick?: (row: Record<string, unknown>, index: number) => void;
}) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);

      try {
        const data = await runQuery(`SELECT * FROM "${tableName}" LIMIT 200`);
        if (!cancelled) {
          setRows(data);
          onRowsLoaded?.(data);
        }
      } catch (error) {
        console.error("Failed to load table preview:", error);
        if (!cancelled) {
          onRowsLoaded?.([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [onRowsLoaded, tableName]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  const colNames = columns.map((column) => column.name);
  const columnTypes: Record<
    string,
    "string" | "number" | "date" | "boolean" | "unknown"
  > = {};

  columns.forEach((column) => {
    columnTypes[column.name] = column.type;
  });

  return (
    <DataTable
      data={rows}
      columns={colNames}
      pageSize={50}
      searchable
      sortable
      exportable
      stickyHeader
      columnTypes={columnTypes}
      onRowClick={onRowClick}
    />
  );
}
