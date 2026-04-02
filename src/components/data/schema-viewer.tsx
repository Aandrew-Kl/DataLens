"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, Download, ChevronRight, Hash, Type, Calendar,
  ToggleLeft, HelpCircle, ArrowUpDown, Database, Layers,
} from "lucide-react";
import type { ColumnProfile, ColumnType } from "@/types/dataset";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";

interface SchemaViewerProps {
  tableName: string;
  columns: ColumnProfile[];
  rowCount: number;
}

type SortKey = "name" | "type" | "nullPct" | "cardinality";
type SortDir = "asc" | "desc";

const TYPE_BADGE: Record<ColumnType, { bg: string; text: string; label: string }> = {
  number:  { bg: "bg-blue-100 dark:bg-blue-900/40",    text: "text-blue-600 dark:text-blue-400",      label: "Number" },
  string:  { bg: "bg-emerald-100 dark:bg-emerald-900/40", text: "text-emerald-600 dark:text-emerald-400", label: "String" },
  date:    { bg: "bg-purple-100 dark:bg-purple-900/40", text: "text-purple-600 dark:text-purple-400",  label: "Date" },
  boolean: { bg: "bg-orange-100 dark:bg-orange-900/40", text: "text-orange-600 dark:text-orange-400",  label: "Boolean" },
  unknown: { bg: "bg-gray-100 dark:bg-gray-800",        text: "text-gray-500 dark:text-gray-400",      label: "Unknown" },
};

const TYPE_ICON: Record<ColumnType, React.ElementType> = {
  number: Hash, string: Type, date: Calendar, boolean: ToggleLeft, unknown: HelpCircle,
};

function getNullPct(col: ColumnProfile, rows: number) {
  return rows > 0 ? (col.nullCount / rows) * 100 : 0;
}
function getCardinality(col: ColumnProfile, rows: number) {
  const nonNull = rows - col.nullCount;
  return nonNull > 0 ? (col.uniqueCount / nonNull) * 100 : 0;
}
function nullColor(pct: number) {
  if (pct === 0) return "bg-emerald-500";
  if (pct < 5)   return "bg-emerald-400";
  if (pct < 20)  return "bg-amber-400";
  return "bg-red-400";
}

/* ------------------------------------------------------------------ */
/*  Schema Summary Card                                                */
/* ------------------------------------------------------------------ */
function SchemaSummary({ columns, rowCount }: { columns: ColumnProfile[]; rowCount: number }) {
  const totalCells = columns.length * rowCount;
  const totalNulls = columns.reduce((s, c) => s + c.nullCount, 0);
  const pct = totalCells > 0 ? (1 - totalNulls / totalCells) * 100 : 100;

  const typeCounts = columns.reduce<Record<string, number>>((a, c) => {
    a[c.type] = (a[c.type] || 0) + 1;
    return a;
  }, {});

  const qColor = pct >= 95 ? "text-emerald-600 dark:text-emerald-400"
    : pct >= 80 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";
  const barColor = pct >= 95 ? "bg-emerald-500" : pct >= 80 ? "bg-amber-500" : "bg-red-500";

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
      className="rounded-xl border border-gray-200/60 dark:border-gray-700/50 bg-white/80 dark:bg-gray-900/60 backdrop-blur-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <Database className="h-4 w-4 text-indigo-500" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Schema Summary</h3>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">Columns</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{columns.length}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">Rows</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{formatNumber(rowCount)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">Completeness</p>
          <p className={`text-xl font-bold ${qColor}`}>{pct.toFixed(1)}%</p>
          <div className="mt-1.5 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-700 ${barColor}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">Total Nulls</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{formatNumber(totalNulls)}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {Object.entries(typeCounts).sort(([, a], [, b]) => b - a).map(([type, count]) => {
          const b = TYPE_BADGE[type as ColumnType];
          const Icon = TYPE_ICON[type as ColumnType];
          return (
            <span key={type} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${b.bg} ${b.text}`}>
              <Icon className="w-3 h-3" />{count} {b.label}
            </span>
          );
        })}
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Expanded detail row (fetches stddev via DuckDB)                    */
/* ------------------------------------------------------------------ */
function ExpandedDetail({ col, tableName, rowCount }: { col: ColumnProfile; tableName: string; rowCount: number }) {
  const [stddev, setStddev] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (col.type !== "number") return;
    let cancelled = false;
    setLoading(true);
    const esc = col.name.replace(/"/g, '""');
    runQuery(`SELECT STDDEV_SAMP("${esc}") AS sd FROM "${tableName}" WHERE "${esc}" IS NOT NULL`)
      .then((r) => { if (!cancelled) setStddev(r[0]?.sd != null ? Number(Number(r[0].sd).toFixed(4)) : null); })
      .catch(() => { if (!cancelled) setStddev(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [col.name, col.type, tableName]);

  const np = getNullPct(col, rowCount);
  const card = getCardinality(col, rowCount);

  const Stat = ({ label, value }: { label: string; value: string | number }) => (
    <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400">
      <span>{label}</span><span className="font-mono">{typeof value === "number" ? formatNumber(value) : value}</span>
    </div>
  );

  return (
    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease: "easeInOut" }} className="overflow-hidden">
      <div className="px-6 py-4 grid grid-cols-1 sm:grid-cols-3 gap-4 bg-gray-50/60 dark:bg-gray-800/30 border-t border-gray-100 dark:border-gray-800">
        {/* Null analysis */}
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold">Null Analysis</p>
          <Stat label="Null count" value={col.nullCount} />
          <Stat label="Null %" value={`${np.toFixed(1)}%`} />
          <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
            <div className={`h-full rounded-full ${nullColor(np)} transition-all duration-500`} style={{ width: `${Math.max(100 - np, 0)}%` }} />
          </div>
        </div>
        {/* Cardinality */}
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold">Cardinality</p>
          <Stat label="Unique values" value={col.uniqueCount} />
          <Stat label="Cardinality" value={`${card.toFixed(1)}%`} />
        </div>
        {/* Type-specific */}
        <div className="space-y-1.5">
          {col.type === "number" && (
            <>
              <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold">Numeric Stats</p>
              {col.min !== undefined && <Stat label="Min" value={col.min as number} />}
              {col.max !== undefined && <Stat label="Max" value={col.max as number} />}
              {col.mean !== undefined && <Stat label="Mean" value={Number(col.mean.toFixed(2))} />}
              {col.median !== undefined && <Stat label="Median" value={Number(col.median.toFixed(2))} />}
              <Stat label="Std Dev" value={loading ? "..." : stddev != null ? stddev : "--"} />
            </>
          )}
          {col.type === "date" && (
            <>
              <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold">Date Range</p>
              {col.min !== undefined && <Stat label="Min date" value={String(col.min)} />}
              {col.max !== undefined && <Stat label="Max date" value={String(col.max)} />}
            </>
          )}
          {col.type !== "number" && col.type !== "date" && (
            <>
              <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold">Details</p>
              <Stat label="Unique values" value={col.uniqueCount} />
            </>
          )}
        </div>
      </div>
      {/* Sample values */}
      {col.sampleValues.length > 0 && (
        <div className="px-6 pb-3 bg-gray-50/60 dark:bg-gray-800/30">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold mb-1.5">Sample Values</p>
          <div className="flex flex-wrap gap-1">
            {col.sampleValues.slice(0, 3).map((v, i) => (
              <span key={i} className="inline-block px-1.5 py-0.5 text-[11px] rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 truncate max-w-[120px] font-mono" title={String(v ?? "null")}>
                {v === null ? "null" : String(v)}
              </span>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sortable table header                                              */
/* ------------------------------------------------------------------ */
function SortHeader({ label, sortKey, currentKey, currentDir, onSort, align = "left" }: {
  label: string; sortKey: SortKey; currentKey: SortKey; currentDir: SortDir;
  onSort: (k: SortKey) => void; align?: "left" | "right";
}) {
  const active = currentKey === sortKey;
  return (
    <th onClick={() => onSort(sortKey)}
      className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors hover:text-indigo-500 dark:hover:text-indigo-400 ${align === "right" ? "text-right" : "text-left"} ${active ? "text-indigo-600 dark:text-indigo-400" : "text-gray-500 dark:text-gray-400"}`}>
      <span className="inline-flex items-center gap-1">
        {label}
        {active && <ArrowUpDown className="w-3 h-3 opacity-70" />}
      </span>
    </th>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */
export default function SchemaViewer({ tableName, columns, rowCount }: SchemaViewerProps) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const handleSort = useCallback((key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }, [sortKey]);

  const displayColumns = useMemo(() => {
    const q = search.toLowerCase().trim();
    const list = q ? columns.filter((c) => c.name.toLowerCase().includes(q)) : [...columns];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name": cmp = a.name.localeCompare(b.name); break;
        case "type": cmp = a.type.localeCompare(b.type); break;
        case "nullPct": cmp = getNullPct(a, rowCount) - getNullPct(b, rowCount); break;
        case "cardinality": cmp = getCardinality(a, rowCount) - getCardinality(b, rowCount); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [columns, search, sortKey, sortDir, rowCount]);

  const toggleExpand = useCallback((name: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);

  const exportJSON = useCallback(() => {
    const payload = {
      tableName, rowCount,
      columns: columns.map((c) => ({
        name: c.name, type: c.type, nullCount: c.nullCount,
        nullPct: rowCount > 0 ? +((c.nullCount / rowCount) * 100).toFixed(2) : 0,
        uniqueCount: c.uniqueCount, sampleValues: c.sampleValues,
        ...(c.min !== undefined && { min: c.min }),
        ...(c.max !== undefined && { max: c.max }),
        ...(c.mean !== undefined && { mean: c.mean }),
        ...(c.median !== undefined && { median: c.median }),
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${tableName}-schema.json`; a.click();
    URL.revokeObjectURL(url);
  }, [tableName, rowCount, columns]);

  if (columns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Layers className="h-10 w-10 text-gray-300 dark:text-gray-600" />
        <p className="text-sm text-gray-400 dark:text-gray-500">No schema information available</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SchemaSummary columns={columns} rowCount={rowCount} />

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter columns..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-colors" />
        </div>
        <button onClick={exportJSON}
          className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
          <Download className="w-3.5 h-3.5" />Export JSON
        </button>
      </div>

      {/* Schema table */}
      <div className="rounded-xl border border-gray-200/60 dark:border-gray-700/50 overflow-hidden bg-white/80 dark:bg-gray-900/60 backdrop-blur-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800/60">
              <th className="w-8" />
              <SortHeader label="Column" sortKey="name" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortHeader label="Type" sortKey="type" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortHeader label="Null %" sortKey="nullPct" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="right" />
              <SortHeader label="Cardinality" sortKey="cardinality" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="right" />
              <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-left">Samples</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {displayColumns.map((col) => {
              const badge = TYPE_BADGE[col.type];
              const Icon = TYPE_ICON[col.type];
              const np = getNullPct(col, rowCount);
              const card = getCardinality(col, rowCount);
              const expanded = expandedRows.has(col.name);
              return (
                <tr key={col.name} className="group">
                  <td className="pl-3 pr-1 py-2.5 cursor-pointer" onClick={() => toggleExpand(col.name)}>
                    <motion.div animate={{ rotate: expanded ? 90 : 0 }} transition={{ duration: 0.15 }}>
                      <ChevronRight className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                    </motion.div>
                  </td>
                  <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white cursor-pointer" onClick={() => toggleExpand(col.name)}>
                    {col.name}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${badge.bg} ${badge.text}`}>
                      <Icon className="w-3 h-3" />{badge.label}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                        <div className={`h-full rounded-full ${nullColor(np)} transition-all duration-500`} style={{ width: `${Math.max(100 - np, 0)}%` }} />
                      </div>
                      <span className={`text-xs font-mono ${np > 20 ? "text-red-600 dark:text-red-400" : np > 0 ? "text-amber-600 dark:text-amber-400" : "text-gray-400 dark:text-gray-500"}`}>
                        {np.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-gray-600 dark:text-gray-400">{card.toFixed(1)}%</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {col.sampleValues.slice(0, 3).map((v, i) => (
                        <span key={i} className="inline-block px-1.5 py-0.5 text-[11px] rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 truncate max-w-[100px] font-mono" title={String(v ?? "null")}>
                          {v === null ? "null" : String(v)}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Expanded detail panels (rendered below table inside the card container) */}
        <AnimatePresence>
          {displayColumns.filter((c) => expandedRows.has(c.name)).map((col) => (
            <ExpandedDetail key={col.name} col={col} tableName={tableName} rowCount={rowCount} />
          ))}
        </AnimatePresence>
      </div>

      {search && (
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Showing {displayColumns.length} of {columns.length} columns
        </p>
      )}
    </div>
  );
}
