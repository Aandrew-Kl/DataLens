"use client";

import { motion } from "framer-motion";
import { Hash, Type, Calendar, ToggleLeft, HelpCircle } from "lucide-react";
import type { ColumnProfile, ColumnType } from "@/types/dataset";
import { formatNumber } from "@/lib/utils/formatters";

interface DataProfilerProps {
  columns: ColumnProfile[];
}

const TYPE_STYLES: Record<ColumnType, { bg: string; text: string; label: string }> = {
  string: {
    bg: "bg-blue-100 dark:bg-blue-900/40",
    text: "text-blue-600 dark:text-blue-400",
    label: "String",
  },
  number: {
    bg: "bg-emerald-100 dark:bg-emerald-900/40",
    text: "text-emerald-600 dark:text-emerald-400",
    label: "Number",
  },
  date: {
    bg: "bg-amber-100 dark:bg-amber-900/40",
    text: "text-amber-600 dark:text-amber-400",
    label: "Date",
  },
  boolean: {
    bg: "bg-purple-100 dark:bg-purple-900/40",
    text: "text-purple-600 dark:text-purple-400",
    label: "Boolean",
  },
  unknown: {
    bg: "bg-gray-100 dark:bg-gray-800",
    text: "text-gray-500 dark:text-gray-400",
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

function StatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-400 dark:text-gray-500">{label}</span>
      <span className="text-xs font-medium text-gray-600 dark:text-gray-300 font-mono">
        {typeof value === "number" ? formatNumber(value) : value}
      </span>
    </div>
  );
}

function ColumnCard({ profile, index }: { profile: ColumnProfile; index: number }) {
  const style = TYPE_STYLES[profile.type];
  const Icon = TYPE_ICONS[profile.type];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.3 }}
      className="rounded-xl border border-gray-200/60 dark:border-gray-700/50 bg-white/80 dark:bg-gray-900/60 backdrop-blur-sm p-4 flex flex-col gap-3"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate flex-1" title={profile.name}>
          {profile.name}
        </h3>
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${style.bg} ${style.text}`}
        >
          <Icon className="w-3 h-3" />
          {style.label}
        </span>
      </div>

      {/* Stats */}
      <div className="flex flex-col gap-1.5">
        <StatRow label="Unique" value={profile.uniqueCount} />
        <StatRow label="Null" value={profile.nullCount} />

        {profile.type === "number" && (
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
              <StatRow label="Median" value={Number(profile.median.toFixed(2))} />
            )}
          </>
        )}

        {profile.type === "date" && profile.min !== undefined && profile.max !== undefined && (
          <StatRow label="Range" value={`${profile.min} - ${profile.max}`} />
        )}
      </div>

      {/* Sample values */}
      {profile.sampleValues.length > 0 && (
        <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5 font-medium">
            Samples
          </p>
          <div className="flex flex-wrap gap-1">
            {profile.sampleValues.slice(0, 5).map((val, i) => (
              <span
                key={i}
                className="inline-block px-1.5 py-0.5 text-[11px] rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 truncate max-w-[120px]"
                title={String(val ?? "null")}
              >
                {val === null ? "null" : String(val)}
              </span>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

export default function DataProfiler({ columns }: DataProfilerProps) {
  if (!columns.length) {
    return (
      <div className="text-center py-12 text-gray-400 dark:text-gray-500 text-sm">
        No column profiles available
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {columns.map((col, i) => (
        <ColumnCard key={col.name} profile={col} index={i} />
      ))}
    </div>
  );
}
