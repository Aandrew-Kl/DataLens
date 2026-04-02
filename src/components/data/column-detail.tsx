"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Hash,
  Type,
  Calendar,
  ToggleLeft,
  HelpCircle,
  Copy,
  Check,
  Filter,
  Group,
  ArrowUpDown,
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
} from "lucide-react";
import type { ColumnProfile, ColumnType } from "@/types/dataset";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";

interface ColumnDetailProps {
  column: ColumnProfile;
  tableName: string;
  onClose: () => void;
  open: boolean;
}

interface DistributionItem {
  label: string;
  count: number;
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
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-xs font-medium text-gray-800 dark:text-gray-200 font-mono">
        {typeof value === "number" ? formatNumber(value) : value}
      </span>
    </div>
  );
}

function NullRateIndicator({ rate }: { rate: number }) {
  let color: string;
  let bgColor: string;
  let Icon: React.ElementType;

  if (rate < 5) {
    color = "text-emerald-600 dark:text-emerald-400";
    bgColor = "bg-emerald-100 dark:bg-emerald-900/40";
    Icon = ShieldCheck;
  } else if (rate < 20) {
    color = "text-amber-600 dark:text-amber-400";
    bgColor = "bg-amber-100 dark:bg-amber-900/40";
    Icon = AlertTriangle;
  } else {
    color = "text-red-600 dark:text-red-400";
    bgColor = "bg-red-100 dark:bg-red-900/40";
    Icon = AlertCircle;
  }

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${bgColor}`}>
      <Icon className={`w-4 h-4 ${color}`} />
      <span className={`text-xs font-semibold ${color}`}>{rate.toFixed(1)}% null</span>
    </div>
  );
}

function BarChart({ items, maxCount }: { items: DistributionItem[]; maxCount: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item, i) => (
        <motion.div
          key={item.label}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.03, duration: 0.25 }}
          className="flex items-center gap-2"
        >
          <span
            className="text-[11px] text-gray-600 dark:text-gray-400 truncate w-24 text-right shrink-0"
            title={item.label}
          >
            {item.label}
          </span>
          <div className="flex-1 h-5 bg-gray-100 dark:bg-gray-800 rounded overflow-hidden">
            <motion.div
              className="h-full bg-purple-500/80 dark:bg-purple-400/60 rounded"
              initial={{ width: 0 }}
              animate={{ width: maxCount > 0 ? `${(item.count / maxCount) * 100}%` : "0%" }}
              transition={{ delay: i * 0.03 + 0.1, duration: 0.4, ease: "easeOut" }}
            />
          </div>
          <span className="text-[11px] font-mono text-gray-500 dark:text-gray-400 w-10 text-right shrink-0">
            {formatNumber(item.count)}
          </span>
        </motion.div>
      ))}
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="
        flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs font-medium
        bg-gray-100 dark:bg-gray-800
        text-gray-700 dark:text-gray-300
        hover:bg-gray-200 dark:hover:bg-gray-700
        transition-colors duration-150
      "
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-emerald-500" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
      <span className="truncate">{label}</span>
    </button>
  );
}

export default function ColumnDetail({
  column,
  tableName,
  onClose,
  open,
}: ColumnDetailProps) {
  const [distribution, setDistribution] = useState<DistributionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [totalRows, setTotalRows] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [open, handleEscape]);

  useEffect(() => {
    if (!open) return;

    async function fetchDistribution() {
      setLoading(true);
      try {
        const countResult = await runQuery(
          `SELECT COUNT(*) as cnt FROM "${tableName}"`
        );
        const rows = Number(countResult[0]?.cnt ?? 0);
        setTotalRows(rows);

        const colName = column.name.replace(/"/g, '""');
        let sql: string;

        if (column.type === "number") {
          sql = `
            WITH bounds AS (
              SELECT MIN("${colName}") as mn, MAX("${colName}") as mx
              FROM "${tableName}"
              WHERE "${colName}" IS NOT NULL
            ),
            bins AS (
              SELECT
                CASE
                  WHEN mx = mn THEN 0
                  ELSE LEAST(FLOOR(("${colName}" - mn) / ((mx - mn) / 10.0))::INT, 9)
                END as bin,
                mn, mx
              FROM "${tableName}", bounds
              WHERE "${colName}" IS NOT NULL
            )
            SELECT
              bin,
              ROUND(MIN(mn) + bin * ((MAX(mx) - MIN(mn)) / 10.0), 2) as lo,
              ROUND(MIN(mn) + (bin + 1) * ((MAX(mx) - MIN(mn)) / 10.0), 2) as hi,
              COUNT(*) as cnt
            FROM bins
            GROUP BY bin
            ORDER BY bin
          `;
        } else if (column.type === "date") {
          sql = `
            SELECT
              STRFTIME(CAST("${colName}" AS DATE), '%Y-%m') as period,
              COUNT(*) as cnt
            FROM "${tableName}"
            WHERE "${colName}" IS NOT NULL
            GROUP BY period
            ORDER BY period
            LIMIT 20
          `;
        } else {
          sql = `
            SELECT
              CAST("${colName}" AS VARCHAR) as val,
              COUNT(*) as cnt
            FROM "${tableName}"
            WHERE "${colName}" IS NOT NULL
            GROUP BY val
            ORDER BY cnt DESC
            LIMIT 10
          `;
        }

        const result = await runQuery(sql);

        const items: DistributionItem[] = result.map((row) => {
          if (column.type === "number") {
            return {
              label: `${row.lo} - ${row.hi}`,
              count: Number(row.cnt),
            };
          } else if (column.type === "date") {
            return {
              label: String(row.period),
              count: Number(row.cnt),
            };
          } else {
            return {
              label: String(row.val ?? "null"),
              count: Number(row.cnt),
            };
          }
        });

        setDistribution(items);
      } catch {
        setDistribution([]);
      } finally {
        setLoading(false);
      }
    }

    fetchDistribution();
  }, [open, column.name, column.type, tableName]);

  const nullRate = totalRows > 0 ? (column.nullCount / totalRows) * 100 : 0;
  const completeness = 100 - nullRate;
  const uniquenessRatio =
    totalRows > 0
      ? ((column.uniqueCount / (totalRows - column.nullCount)) * 100).toFixed(1)
      : "0";

  const maxDistCount = Math.max(...distribution.map((d) => d.count), 1);

  const Icon = TYPE_ICONS[column.type];
  const style = TYPE_STYLES[column.type];

  const escapedCol = `"${column.name}"`;
  const filterQuery = `SELECT * FROM "${tableName}" WHERE ${escapedCol} = '';`;
  const groupQuery = `SELECT ${escapedCol}, COUNT(*) as count FROM "${tableName}" GROUP BY ${escapedCol} ORDER BY count DESC;`;
  const sortQuery = `SELECT * FROM "${tableName}" ORDER BY ${escapedCol} DESC;`;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex justify-end"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Panel */}
          <motion.div
            ref={panelRef}
            className="
              relative w-full max-w-[400px] h-full
              bg-white/95 dark:bg-gray-900/95
              backdrop-blur-xl
              border-l border-gray-200/50 dark:border-gray-700/50
              shadow-2xl
              flex flex-col
            "
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`Column detail: ${column.name}`}
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-200/60 dark:border-gray-700/50 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`p-2 rounded-lg ${style.bg}`}>
                  <Icon className={`w-4 h-4 ${style.text}`} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">
                    {column.name}
                  </h2>
                  <span className={`text-[10px] font-semibold uppercase tracking-wide ${style.text}`}>
                    {style.label}
                  </span>
                </div>
              </div>
              <button
                onClick={onClose}
                className="
                  p-1.5 rounded-lg shrink-0
                  text-gray-400 hover:text-gray-600
                  dark:text-gray-500 dark:hover:text-gray-300
                  hover:bg-gray-100 dark:hover:bg-gray-800
                  transition-colors duration-150
                "
                aria-label="Close panel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {/* Data Quality */}
              <section>
                <h3 className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold mb-3">
                  Data Quality
                </h3>
                <div className="space-y-2">
                  <NullRateIndicator rate={nullRate} />
                  <div className="grid grid-cols-2 gap-2">
                    <div className="px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/60">
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                        Completeness
                      </p>
                      <p className="text-sm font-bold text-gray-800 dark:text-gray-200 font-mono">
                        {completeness.toFixed(1)}%
                      </p>
                    </div>
                    <div className="px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/60">
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                        Uniqueness
                      </p>
                      <p className="text-sm font-bold text-gray-800 dark:text-gray-200 font-mono">
                        {uniquenessRatio}%
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              {/* Statistics */}
              <section>
                <h3 className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold mb-2">
                  Statistics
                </h3>
                <div className="rounded-lg border border-gray-200/60 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/30 px-3 py-1 divide-y divide-gray-100 dark:divide-gray-800">
                  <StatRow label="Unique Values" value={column.uniqueCount} />
                  <StatRow label="Null Count" value={column.nullCount} />
                  <StatRow label="Null %" value={`${nullRate.toFixed(1)}%`} />

                  {column.type === "number" && (
                    <>
                      {column.min !== undefined && (
                        <StatRow label="Min" value={column.min as number} />
                      )}
                      {column.max !== undefined && (
                        <StatRow label="Max" value={column.max as number} />
                      )}
                      {column.mean !== undefined && (
                        <StatRow label="Mean" value={Number(column.mean.toFixed(2))} />
                      )}
                      {column.median !== undefined && (
                        <StatRow label="Median" value={Number(column.median.toFixed(2))} />
                      )}
                    </>
                  )}

                  {column.type === "date" && (
                    <>
                      {column.min !== undefined && (
                        <StatRow label="Min Date" value={String(column.min)} />
                      )}
                      {column.max !== undefined && (
                        <StatRow label="Max Date" value={String(column.max)} />
                      )}
                      {column.min !== undefined && column.max !== undefined && (
                        <StatRow
                          label="Range"
                          value={`${column.min} to ${column.max}`}
                        />
                      )}
                    </>
                  )}

                  {column.type === "boolean" && (
                    <>
                      <StatRow
                        label="True Count"
                        value={
                          column.sampleValues.filter((v) => v === true).length > 0
                            ? `~${column.uniqueCount <= 2 ? totalRows - column.nullCount : 0}`
                            : "N/A"
                        }
                      />
                      <StatRow
                        label="False Count"
                        value={
                          column.sampleValues.filter((v) => v === false).length > 0
                            ? `~${column.uniqueCount <= 2 ? totalRows - column.nullCount : 0}`
                            : "N/A"
                        }
                      />
                    </>
                  )}
                </div>
              </section>

              {/* Sample Values (for strings) */}
              {column.type === "string" && column.sampleValues.length > 0 && (
                <section>
                  <h3 className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold mb-2">
                    Sample Values
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {column.sampleValues.slice(0, 10).map((val, i) => (
                      <span
                        key={i}
                        className="
                          inline-block px-2 py-1 text-[11px] rounded-md
                          bg-gray-100 dark:bg-gray-800
                          text-gray-600 dark:text-gray-400
                          truncate max-w-[160px]
                          border border-gray-200/60 dark:border-gray-700/40
                        "
                        title={String(val ?? "null")}
                      >
                        {val === null ? "null" : String(val)}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {/* Distribution Chart */}
              <section>
                <h3 className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold mb-3">
                  {column.type === "number"
                    ? "Histogram"
                    : column.type === "date"
                      ? "Monthly Distribution"
                      : "Top Values"}
                </h3>
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <motion.div
                      className="w-5 h-5 border-2 border-purple-500/30 border-t-purple-500 rounded-full"
                      animate={{ rotate: 360 }}
                      transition={{
                        repeat: Infinity,
                        duration: 0.8,
                        ease: "linear",
                      }}
                    />
                  </div>
                ) : distribution.length > 0 ? (
                  <BarChart items={distribution} maxCount={maxDistCount} />
                ) : (
                  <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-4">
                    No distribution data available
                  </p>
                )}
              </section>

              {/* Quick Actions */}
              <section>
                <h3 className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold mb-3">
                  Quick Actions
                </h3>
                <div className="space-y-2">
                  <CopyButton
                    text={filterQuery}
                    label="Filter by this column"
                  />
                  <CopyButton
                    text={groupQuery}
                    label="Group by this column"
                  />
                  <CopyButton
                    text={sortQuery}
                    label="Sort by this column"
                  />
                </div>
              </section>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
