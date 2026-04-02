"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Database,
  FileText,
  Sigma,
  Table2,
} from "lucide-react";
import type { ColumnProfile, DatasetMeta } from "@/types/dataset";
import { formatNumber } from "@/lib/utils/formatters";

interface DataSummaryProps {
  dataset: DatasetMeta;
  columns: ColumnProfile[];
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatColumnTypeLabel(type: ColumnProfile["type"]) {
  switch (type) {
    case "number":
      return "numeric";
    case "string":
      return "text";
    case "date":
      return "date";
    case "boolean":
      return "boolean";
    default:
      return "unknown";
  }
}

export default function DataSummary({
  dataset,
  columns,
}: DataSummaryProps) {
  const stats = useMemo(() => {
    const numericColumns = columns.filter((column) => column.type === "number");
    const textColumns = columns.filter((column) => column.type === "string");
    const dateColumns = columns.filter((column) => column.type === "date");
    const booleanColumns = columns.filter((column) => column.type === "boolean");
    const unknownColumns = columns.filter((column) => column.type === "unknown");

    const totalCells = dataset.rowCount * Math.max(columns.length, 1);
    const nullCells = columns.reduce((sum, column) => sum + column.nullCount, 0);
    const completeness =
      totalCells > 0 ? ((totalCells - nullCells) / totalCells) * 100 : 100;

    const sparsestColumn = columns.reduce<ColumnProfile | null>((current, column) => {
      if (!current) {
        return column;
      }

      const currentMissingRate =
        dataset.rowCount > 0 ? current.nullCount / dataset.rowCount : 0;
      const candidateMissingRate =
        dataset.rowCount > 0 ? column.nullCount / dataset.rowCount : 0;

      return candidateMissingRate > currentMissingRate ? column : current;
    }, null);

    const qualityIssues = [
      ...columns
        .filter(
          (column) =>
            dataset.rowCount > 0 && column.nullCount / dataset.rowCount >= 0.2,
        )
        .slice(0, 2)
        .map((column) => ({
          label: `${column.name} is ${formatPercent(
            (column.nullCount / Math.max(dataset.rowCount, 1)) * 100,
          )} null and may need cleanup.`,
          severity: "warning" as const,
        })),
      ...columns
        .filter(
          (column) =>
            dataset.rowCount > 1 &&
            column.uniqueCount <= 1 &&
            column.nullCount < dataset.rowCount,
        )
        .slice(0, 2)
        .map((column) => ({
          label: `${column.name} is effectively constant across the dataset.`,
          severity: "warning" as const,
        })),
      ...unknownColumns.slice(0, 2).map((column) => ({
        label: `${column.name} could not be typed automatically and may need manual review.`,
        severity: "warning" as const,
      })),
    ];

    return {
      numericColumns,
      textColumns,
      dateColumns,
      booleanColumns,
      unknownColumns,
      completeness,
      sparsestColumn,
      qualityIssues: qualityIssues.slice(0, 4),
    };
  }, [columns, dataset.rowCount]);

  const summary = useMemo(() => {
    const opening = `${dataset.fileName} contains ${formatNumber(
      dataset.rowCount,
    )} rows across ${formatNumber(dataset.columnCount)} columns.`;

    const breakdown = `The schema leans ${stats.numericColumns.length >= stats.textColumns.length ? "numeric" : "textual"} with ${stats.numericColumns.length} numeric, ${stats.textColumns.length} text, ${stats.dateColumns.length} date, and ${stats.booleanColumns.length} boolean columns.`;

    const completenessLine = `Estimated cell completeness is ${formatPercent(
      stats.completeness,
    )}.`;

    const sparsestLine = stats.sparsestColumn
      ? `${stats.sparsestColumn.name} is the sparsest field, with ${formatPercent(
          (stats.sparsestColumn.nullCount / Math.max(dataset.rowCount, 1)) * 100,
        )} missing values.`
      : "No sparsity signal is available yet.";

    return [opening, breakdown, completenessLine, sparsestLine].join(" ");
  }, [dataset.columnCount, dataset.fileName, dataset.rowCount, stats]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: "easeOut" }}
      className="overflow-hidden rounded-xl border border-gray-200/70 bg-white/80 backdrop-blur-sm dark:border-gray-700/70 dark:bg-gray-900/60"
    >
      <div className="border-b border-gray-200/70 px-6 py-5 dark:border-gray-700/70">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:border-emerald-700/40 dark:text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Data Summary
            </div>
            <h2 className="mt-3 text-xl font-semibold text-gray-900 dark:text-gray-50">
              Quick health readout for {dataset.name}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600 dark:text-gray-300">
              {summary}
            </p>
          </div>

          <div className="rounded-xl border border-gray-200/70 bg-gray-50/80 px-4 py-3 text-sm dark:border-gray-700/70 dark:bg-gray-950/30">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
              Completeness
            </p>
            <p className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">
              {formatPercent(stats.completeness)}
            </p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
              <div
                className={`h-full rounded-full ${
                  stats.completeness >= 95
                    ? "bg-emerald-500"
                    : stats.completeness >= 80
                      ? "bg-amber-400"
                      : "bg-red-400"
                }`}
                style={{ width: `${Math.max(4, stats.completeness)}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 px-6 py-6 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-gray-200/70 bg-gray-50/80 p-4 dark:border-gray-700/70 dark:bg-gray-950/30">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
            <Table2 className="h-4 w-4 text-sky-500" />
            Shape
          </div>
          <div className="mt-3 space-y-2 text-sm text-gray-700 dark:text-gray-200">
            <p className="flex items-center justify-between gap-3">
              <span>Rows</span>
              <span className="font-semibold">{formatNumber(dataset.rowCount)}</span>
            </p>
            <p className="flex items-center justify-between gap-3">
              <span>Columns</span>
              <span className="font-semibold">{formatNumber(dataset.columnCount)}</span>
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200/70 bg-gray-50/80 p-4 dark:border-gray-700/70 dark:bg-gray-950/30">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
            <Sigma className="h-4 w-4 text-violet-500" />
            Column Mix
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-gray-700 dark:text-gray-200">
            <p className="rounded-lg bg-white/80 px-3 py-2 dark:bg-gray-900/70">
              <span className="block text-xs text-gray-500 dark:text-gray-400">
                Numeric
              </span>
              <span className="mt-1 block font-semibold">
                {stats.numericColumns.length}
              </span>
            </p>
            <p className="rounded-lg bg-white/80 px-3 py-2 dark:bg-gray-900/70">
              <span className="block text-xs text-gray-500 dark:text-gray-400">
                Text
              </span>
              <span className="mt-1 block font-semibold">
                {stats.textColumns.length}
              </span>
            </p>
            <p className="rounded-lg bg-white/80 px-3 py-2 dark:bg-gray-900/70">
              <span className="block text-xs text-gray-500 dark:text-gray-400">
                Date
              </span>
              <span className="mt-1 block font-semibold">
                {stats.dateColumns.length}
              </span>
            </p>
            <p className="rounded-lg bg-white/80 px-3 py-2 dark:bg-gray-900/70">
              <span className="block text-xs text-gray-500 dark:text-gray-400">
                Other
              </span>
              <span className="mt-1 block font-semibold">
                {stats.booleanColumns.length + stats.unknownColumns.length}
              </span>
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200/70 bg-gray-50/80 p-4 dark:border-gray-700/70 dark:bg-gray-950/30">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
            <BarChart3 className="h-4 w-4 text-amber-500" />
            Sparsest Column
          </div>
          <div className="mt-3 text-sm text-gray-700 dark:text-gray-200">
            {stats.sparsestColumn ? (
              <>
                <p className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  {stats.sparsestColumn.name}
                </p>
                <p className="mt-2">
                  {formatPercent(
                    (stats.sparsestColumn.nullCount / Math.max(dataset.rowCount, 1)) *
                      100,
                  )}{" "}
                  missing
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Detected as {formatColumnTypeLabel(stats.sparsestColumn.type)}
                </p>
              </>
            ) : (
              <p>No sparsity signal available.</p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200/70 bg-gray-50/80 p-4 dark:border-gray-700/70 dark:bg-gray-950/30">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
            <Database className="h-4 w-4 text-emerald-500" />
            Schema Notes
          </div>
          <div className="mt-3 space-y-2 text-sm text-gray-700 dark:text-gray-200">
            <p className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-500" />
              {stats.textColumns.length} descriptive fields
            </p>
            <p className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-amber-500" />
              {stats.dateColumns.length} time-aware fields
            </p>
            <p className="flex items-center gap-2">
              <Sigma className="h-4 w-4 text-violet-500" />
              {stats.numericColumns.length} measurable fields
            </p>
          </div>
        </div>
      </div>

      <div className="border-t border-gray-200/70 px-6 py-6 dark:border-gray-700/70">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
          {stats.qualityIssues.length > 0 ? (
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          )}
          Quality issues
        </div>

        {stats.qualityIssues.length > 0 ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {stats.qualityIssues.map((issue) => (
              <div
                key={issue.label}
                className="rounded-xl border border-amber-300/40 bg-amber-500/10 p-4 text-sm text-amber-900 dark:border-amber-800/40 dark:text-amber-200"
              >
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>{issue.label}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-emerald-300/40 bg-emerald-500/10 p-4 text-sm text-emerald-900 dark:border-emerald-800/40 dark:text-emerald-200">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <p>No major quality issues were detected from the current column profiles.</p>
            </div>
          </div>
        )}
      </div>
    </motion.section>
  );
}
