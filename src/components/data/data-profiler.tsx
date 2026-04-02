"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Hash,
  Type,
  Calendar,
  ToggleLeft,
  HelpCircle,
  AlertTriangle,
  CheckCircle,
  ChevronRight,
  BarChart3,
  Shield,
} from "lucide-react";
import type { ColumnProfile, ColumnType } from "@/types/dataset";
import { formatNumber } from "@/lib/utils/formatters";

interface DataProfilerProps {
  columns: ColumnProfile[];
  rowCount?: number;
  onColumnClick?: (column: ColumnProfile) => void;
  compact?: boolean;
}

const TYPE_STYLES: Record<
  ColumnType,
  { bg: string; text: string; label: string; border: string }
> = {
  string: {
    bg: "bg-blue-100 dark:bg-blue-900/40",
    text: "text-blue-600 dark:text-blue-400",
    border: "border-blue-200 dark:border-blue-800/50",
    label: "String",
  },
  number: {
    bg: "bg-emerald-100 dark:bg-emerald-900/40",
    text: "text-emerald-600 dark:text-emerald-400",
    border: "border-emerald-200 dark:border-emerald-800/50",
    label: "Number",
  },
  date: {
    bg: "bg-amber-100 dark:bg-amber-900/40",
    text: "text-amber-600 dark:text-amber-400",
    border: "border-amber-200 dark:border-amber-800/50",
    label: "Date",
  },
  boolean: {
    bg: "bg-purple-100 dark:bg-purple-900/40",
    text: "text-purple-600 dark:text-purple-400",
    border: "border-purple-200 dark:border-purple-800/50",
    label: "Boolean",
  },
  unknown: {
    bg: "bg-gray-100 dark:bg-gray-800",
    text: "text-gray-500 dark:text-gray-400",
    border: "border-gray-200 dark:border-gray-700",
    label: "Unknown",
  },
};

const TYPE_ICONS: Record<ColumnType, React.ElementType> = {
  string: Type,
  number: Hash,
  date: Calendar,
  boolean: ToggleLeft,
  unknown: HelpCircle,
};

function StatRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string | number;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-400 dark:text-gray-500">{label}</span>
      <span
        className={`text-xs font-medium font-mono ${
          highlight
            ? "text-amber-600 dark:text-amber-400"
            : "text-gray-600 dark:text-gray-300"
        }`}
      >
        {typeof value === "number" ? formatNumber(value) : value}
      </span>
    </div>
  );
}

function NullBar({ nullCount, totalRows }: { nullCount: number; totalRows: number }) {
  if (totalRows === 0) return null;
  const pct = (nullCount / totalRows) * 100;
  const color =
    pct === 0
      ? "bg-emerald-500"
      : pct < 5
      ? "bg-emerald-400"
      : pct < 20
      ? "bg-amber-400"
      : "bg-red-400";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-400 dark:text-gray-500">Completeness</span>
        <span className="text-[10px] font-mono text-gray-500 dark:text-gray-400">
          {(100 - pct).toFixed(1)}%
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all duration-500`}
          style={{ width: `${100 - pct}%` }}
        />
      </div>
    </div>
  );
}

function ColumnCard({
  profile,
  index,
  rowCount,
  onClick,
  compact,
}: {
  profile: ColumnProfile;
  index: number;
  rowCount: number;
  onClick?: () => void;
  compact?: boolean;
}) {
  const style = TYPE_STYLES[profile.type];
  const Icon = TYPE_ICONS[profile.type];
  const nullPct = rowCount > 0 ? (profile.nullCount / rowCount) * 100 : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03, duration: 0.3 }}
      onClick={onClick}
      className={`
        rounded-xl border border-gray-200/60 dark:border-gray-700/50
        bg-white/80 dark:bg-gray-900/60 backdrop-blur-sm
        flex flex-col gap-3
        transition-all duration-200
        ${onClick ? "cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-700 hover:shadow-md hover:shadow-indigo-500/5" : ""}
        ${compact ? "p-3" : "p-4"}
      `}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <h3
            className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate"
            title={profile.name}
          >
            {profile.name}
          </h3>
          {nullPct > 20 && (
            <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${style.bg} ${style.text}`}
          >
            <Icon className="w-3 h-3" />
            {style.label}
          </span>
          {onClick && (
            <ChevronRight className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600" />
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="flex flex-col gap-1.5">
        <StatRow label="Unique" value={profile.uniqueCount} />
        <StatRow
          label="Nulls"
          value={profile.nullCount}
          highlight={nullPct > 20}
        />

        {profile.type === "number" && !compact && (
          <>
            {profile.min !== undefined && (
              <StatRow label="Min" value={profile.min as number} />
            )}
            {profile.max !== undefined && (
              <StatRow label="Max" value={profile.max as number} />
            )}
            {profile.mean !== undefined && (
              <StatRow label="Mean" value={Number(profile.mean.toFixed(2))} />
            )}
            {profile.median !== undefined && (
              <StatRow
                label="Median"
                value={Number(profile.median.toFixed(2))}
              />
            )}
          </>
        )}

        {profile.type === "date" &&
          !compact &&
          profile.min !== undefined &&
          profile.max !== undefined && (
            <StatRow label="Range" value={`${profile.min} — ${profile.max}`} />
          )}
      </div>

      {/* Completeness bar */}
      {rowCount > 0 && <NullBar nullCount={profile.nullCount} totalRows={rowCount} />}

      {/* Sample values */}
      {profile.sampleValues.length > 0 && !compact && (
        <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5 font-medium">
            Samples
          </p>
          <div className="flex flex-wrap gap-1">
            {profile.sampleValues.slice(0, 5).map((val, i) => (
              <span
                key={i}
                className="inline-block px-1.5 py-0.5 text-[11px] rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 truncate max-w-[120px] font-mono"
                title={String(val ?? "null")}
              >
                {val === null ? (
                  <span className="italic text-gray-400">null</span>
                ) : (
                  String(val)
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

/** Data quality overview section */
function QualityOverview({
  columns,
  rowCount,
}: {
  columns: ColumnProfile[];
  rowCount: number;
}) {
  if (rowCount === 0 || columns.length === 0) return null;

  const totalCells = columns.length * rowCount;
  const totalNulls = columns.reduce((acc, col) => acc + col.nullCount, 0);
  const completeness = ((1 - totalNulls / totalCells) * 100).toFixed(1);
  const completeNum = parseFloat(completeness);

  const issueColumns = columns.filter(
    (c) => (c.nullCount / rowCount) * 100 > 20
  );
  const emptyColumns = columns.filter(
    (c) => c.nullCount === rowCount
  );
  const uniqueIdCandidates = columns.filter(
    (c) => c.uniqueCount === rowCount && c.type === "string"
  );

  const qualityColor =
    completeNum >= 95
      ? "text-emerald-600 dark:text-emerald-400"
      : completeNum >= 80
      ? "text-amber-600 dark:text-amber-400"
      : "text-red-600 dark:text-red-400";

  const qualityBg =
    completeNum >= 95
      ? "bg-emerald-500"
      : completeNum >= 80
      ? "bg-amber-500"
      : "bg-red-500";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-xl border border-gray-200/60 dark:border-gray-700/50 bg-white/80 dark:bg-gray-900/60 backdrop-blur-sm p-5"
    >
      <div className="flex items-center gap-2 mb-4">
        <Shield className="h-4 w-4 text-indigo-500" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
          Data Quality
        </h3>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">
            Completeness
          </p>
          <p className={`text-xl font-bold ${qualityColor}`}>
            {completeness}%
          </p>
          <div className="mt-1.5 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <div
              className={`h-full rounded-full ${qualityBg} transition-all duration-700`}
              style={{ width: `${completeNum}%` }}
            />
          </div>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">
            Columns
          </p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">
            {columns.length}
          </p>
          <p className="text-[10px] text-gray-400 mt-1">
            {columns.filter((c) => c.type === "number").length} numeric,{" "}
            {columns.filter((c) => c.type === "string").length} text
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">
            Total Nulls
          </p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">
            {formatNumber(totalNulls)}
          </p>
          <p className="text-[10px] text-gray-400 mt-1">
            across all columns
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">
            ID Candidates
          </p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">
            {uniqueIdCandidates.length}
          </p>
          <p className="text-[10px] text-gray-400 mt-1">
            unique per row
          </p>
        </div>
      </div>

      {/* Issues */}
      {(issueColumns.length > 0 || emptyColumns.length > 0) && (
        <div className="border-t border-gray-100 dark:border-gray-800 pt-3 space-y-2">
          {emptyColumns.map((col) => (
            <div
              key={col.name}
              className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400"
            >
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span>
                <strong>{col.name}</strong> is completely empty (100% nulls)
              </span>
            </div>
          ))}
          {issueColumns
            .filter((c) => c.nullCount !== rowCount)
            .map((col) => (
              <div
                key={col.name}
                className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400"
              >
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <span>
                  <strong>{col.name}</strong> has{" "}
                  {((col.nullCount / rowCount) * 100).toFixed(1)}% null values
                </span>
              </div>
            ))}
          {issueColumns.length === 0 && emptyColumns.length === 0 && (
            <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
              <CheckCircle className="h-3 w-3 shrink-0" />
              <span>No data quality issues detected</span>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

/** Type distribution summary */
function TypeDistribution({ columns }: { columns: ColumnProfile[] }) {
  const typeCounts = columns.reduce(
    (acc, col) => {
      acc[col.type] = (acc[col.type] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const total = columns.length;

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {Object.entries(typeCounts)
        .sort(([, a], [, b]) => b - a)
        .map(([type, count]) => {
          const style = TYPE_STYLES[type as ColumnType];
          const Icon = TYPE_ICONS[type as ColumnType];
          const pct = ((count / total) * 100).toFixed(0);

          return (
            <div
              key={type}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${style.bg} ${style.text} text-xs font-medium`}
            >
              <Icon className="w-3 h-3" />
              <span>
                {count} {style.label}
              </span>
              <span className="opacity-60">({pct}%)</span>
            </div>
          );
        })}
    </div>
  );
}

export default function DataProfiler({
  columns,
  rowCount = 0,
  onColumnClick,
  compact = false,
}: DataProfilerProps) {
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  if (!columns.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <BarChart3 className="h-10 w-10 text-gray-300 dark:text-gray-600" />
        <p className="text-sm text-gray-400 dark:text-gray-500">
          No column profiles available
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Quality overview */}
      {rowCount > 0 && (
        <QualityOverview columns={columns} rowCount={rowCount} />
      )}

      {/* Header with type distribution and view toggle */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <TypeDistribution columns={columns} />
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
          <button
            onClick={() => setViewMode("grid")}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
              viewMode === "grid"
                ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            Grid
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
              viewMode === "list"
                ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            List
          </button>
        </div>
      </div>

      {/* Column cards */}
      {viewMode === "grid" ? (
        <div
          className={`grid gap-4 ${
            compact
              ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
              : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          }`}
        >
          {columns.map((col, i) => (
            <ColumnCard
              key={col.name}
              profile={col}
              index={i}
              rowCount={rowCount}
              onClick={onColumnClick ? () => onColumnClick(col) : undefined}
              compact={compact}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200/60 dark:border-gray-700/50 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800/60">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Column
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Type
                </th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Unique
                </th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Nulls
                </th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Complete
                </th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Min
                </th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Max
                </th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Mean
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {columns.map((col) => {
                const style = TYPE_STYLES[col.type];
                const Icon = TYPE_ICONS[col.type];
                const nullPct =
                  rowCount > 0
                    ? ((1 - col.nullCount / rowCount) * 100).toFixed(1)
                    : "—";

                return (
                  <tr
                    key={col.name}
                    onClick={
                      onColumnClick ? () => onColumnClick(col) : undefined
                    }
                    className={`hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors ${
                      onColumnClick ? "cursor-pointer" : ""
                    }`}
                  >
                    <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white text-sm">
                      {col.name}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${style.bg} ${style.text}`}
                      >
                        <Icon className="w-3 h-3" />
                        {style.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-gray-600 dark:text-gray-400">
                      {formatNumber(col.uniqueCount)}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right font-mono text-xs ${
                        col.nullCount > 0
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-gray-400 dark:text-gray-500"
                      }`}
                    >
                      {formatNumber(col.nullCount)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-gray-600 dark:text-gray-400">
                      {nullPct}%
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-gray-600 dark:text-gray-400">
                      {col.min !== undefined
                        ? typeof col.min === "number"
                          ? formatNumber(col.min)
                          : String(col.min).slice(0, 12)
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-gray-600 dark:text-gray-400">
                      {col.max !== undefined
                        ? typeof col.max === "number"
                          ? formatNumber(col.max)
                          : String(col.max).slice(0, 12)
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-gray-600 dark:text-gray-400">
                      {col.mean !== undefined
                        ? formatNumber(Number(col.mean.toFixed(2)))
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
