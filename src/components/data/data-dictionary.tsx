"use client";

import { Fragment, useDeferredValue, useEffect, useMemo, useState, type ElementType } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart3,
  Calendar,
  ChevronRight,
  Database,
  Download,
  FileText,
  Hash,
  HelpCircle,
  Pencil,
  Search,
  ToggleLeft,
  Type,
} from "lucide-react";
import type { ColumnProfile, ColumnType } from "@/types/dataset";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";

interface DataDictionaryProps {
  tableName: string;
  columns: ColumnProfile[];
  rowCount: number;
}

type FilterType = ColumnType | "all";
type DictionaryColumn = ColumnProfile & { detectedType: ColumnType; description: string };

const STORAGE_PREFIX = "datalens:data-dictionary";
const FILTERS: FilterType[] = ["all", "string", "number", "date", "boolean", "unknown"];
const TYPE_META: Record<ColumnType, { label: string; tone: string; icon: ElementType }> = {
  string: { label: "String", tone: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300", icon: Type },
  number: { label: "Number", tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300", icon: Hash },
  date: { label: "Date", tone: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300", icon: Calendar },
  boolean: { label: "Boolean", tone: "bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300", icon: ToggleLeft },
  unknown: { label: "Unknown", tone: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300", icon: HelpCircle },
};

function readDescriptions(key: string): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function normalize(value: string | number | boolean | null): string {
  return value === null ? "" : String(value).trim();
}

function looksBoolean(value: string) {
  return /^(true|false|yes|no|0|1)$/i.test(value);
}

function looksNumber(value: string) {
  return Boolean(value) && !looksBoolean(value) && /^-?\d+(\.\d+)?$/.test(value.replace(/,/g, ""));
}

function looksDate(value: string) {
  return Boolean(value) && !looksNumber(value) && Number.isFinite(Date.parse(value));
}

function detectColumnType(column: ColumnProfile): ColumnType {
  const values = column.sampleValues.map(normalize).filter(Boolean);
  if (!values.length) return column.type;
  if (values.every(looksBoolean)) return "boolean";
  if (values.every(looksNumber)) return "number";
  if (values.every(looksDate)) return "date";
  return "string";
}

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function getNullRate(column: ColumnProfile, rowCount: number) {
  return rowCount > 0 ? (column.nullCount / rowCount) * 100 : 0;
}

function getUniqueRate(column: ColumnProfile, rowCount: number) {
  const nonNull = Math.max(rowCount - column.nullCount, 0);
  return nonNull > 0 ? (column.uniqueCount / nonNull) * 100 : 0;
}

function getStats(column: ColumnProfile, detectedType: ColumnType, rowCount: number) {
  const base = [
    { label: "Null rate", value: formatPercent(getNullRate(column, rowCount)) },
    { label: "Coverage", value: formatPercent(100 - getNullRate(column, rowCount)) },
    { label: "Unique", value: formatNumber(column.uniqueCount) },
  ];
  if (detectedType === "number") {
    return [...base, { label: "Min", value: formatValue(column.min) }, { label: "Max", value: formatValue(column.max) }, { label: "Mean", value: formatValue(column.mean) }, { label: "Median", value: formatValue(column.median) }];
  }
  if (detectedType === "date") {
    return [...base, { label: "Min", value: formatValue(column.min) }, { label: "Max", value: formatValue(column.max) }];
  }
  return [...base, { label: "Distinctness", value: formatPercent(getUniqueRate(column, rowCount)) }];
}

function buildPayload(tableName: string, rowCount: number, columns: DictionaryColumn[]) {
  return {
    tableName,
    rowCount,
    exportedAt: new Date().toISOString(),
    columns: columns.map((column) => ({
      name: column.name,
      type: column.detectedType,
      description: column.description,
      nullCount: column.nullCount,
      uniqueCount: column.uniqueCount,
      sampleValues: column.sampleValues,
      min: column.min,
      max: column.max,
      mean: column.mean,
      median: column.median,
    })),
  };
}

function buildMarkdown(payload: ReturnType<typeof buildPayload>) {
  const lines = [`# Data Dictionary: ${payload.tableName}`, "", `Rows: ${payload.rowCount}`, `Columns: ${payload.columns.length}`, ""];
  for (const column of payload.columns) {
    lines.push(`## ${column.name}`);
    lines.push(`- Type: ${column.type}`);
    lines.push(`- Description: ${column.description || "No description provided."}`);
    lines.push(`- Null count: ${column.nullCount}`);
    lines.push(`- Unique count: ${column.uniqueCount}`);
    lines.push(`- Sample values: ${column.sampleValues.length ? column.sampleValues.map(formatValue).join(", ") : "—"}`);
    if (column.min !== undefined) lines.push(`- Min: ${formatValue(column.min)}`);
    if (column.max !== undefined) lines.push(`- Max: ${formatValue(column.max)}`);
    if (column.mean !== undefined) lines.push(`- Mean: ${formatValue(column.mean)}`);
    if (column.median !== undefined) lines.push(`- Median: ${formatValue(column.median)}`);
    lines.push("");
  }
  return lines.join("\n");
}

function TypeBadge({ type }: { type: ColumnType }) {
  const { label, tone, icon: Icon } = TYPE_META[type];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

export default function DataDictionary({ tableName, columns, rowCount }: DataDictionaryProps) {
  const storageKey = `${STORAGE_PREFIX}:${tableName}`;
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [expandedRows, setExpandedRows] = useState<string[]>([]);
  const [store, setStore] = useState<Record<string, Record<string, string>>>(() => ({ [storageKey]: readDescriptions(storageKey) }));
  const deferredSearch = useDeferredValue(search);
  const descriptions = store[storageKey] ?? readDescriptions(storageKey);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(descriptions));
    } catch {
      // localStorage unavailable or full.
    }
  }, [descriptions, storageKey]);

  const enrichedColumns = useMemo<DictionaryColumn[]>(
    () => columns.map((column) => ({ ...column, detectedType: detectColumnType(column), description: descriptions[column.name]?.trim() ?? "" })),
    [columns, descriptions],
  );

  const filteredColumns = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    return enrichedColumns.filter((column) => {
      const matchesType = filterType === "all" || column.detectedType === filterType;
      const matchesQuery = !query || column.name.toLowerCase().includes(query) || column.description.toLowerCase().includes(query) || column.detectedType.includes(query);
      return matchesType && matchesQuery;
    });
  }, [deferredSearch, enrichedColumns, filterType]);

  const documentedCount = enrichedColumns.filter((column) => column.description).length;
  const completeness = enrichedColumns.length ? (documentedCount / enrichedColumns.length) * 100 : 0;
  const typeCounts = enrichedColumns.reduce<Record<FilterType, number>>(
    (acc, column) => ((acc[column.detectedType] += 1), (acc.all += 1), acc),
    { all: 0, string: 0, number: 0, date: 0, boolean: 0, unknown: 0 },
  );

  function updateDescription(name: string, value: string) {
    setStore((prev) => ({ ...prev, [storageKey]: { ...(prev[storageKey] ?? descriptions), [name]: value } }));
  }

  function toggleRow(name: string) {
    setExpandedRows((prev) => (prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name]));
  }

  function exportDictionary(format: "json" | "md") {
    const payload = buildPayload(tableName, rowCount, enrichedColumns);
    const content = format === "json" ? JSON.stringify(payload, null, 2) : buildMarkdown(payload);
    const mime = format === "json" ? "application/json;charset=utf-8;" : "text/markdown;charset=utf-8;";
    downloadFile(content, `${tableName}-data-dictionary.${format === "json" ? "json" : "md"}`, mime);
  }

  return (
    <div className="space-y-4">
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-gray-200/70 bg-white/85 p-5 shadow-sm backdrop-blur dark:border-gray-800 dark:bg-gray-900/75"
      >
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Data Dictionary</h2>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Documentation for <span className="font-medium text-gray-900 dark:text-white">{tableName}</span>. Edit descriptions inline, filter the schema, and export the result as JSON or Markdown.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="relative block min-w-0 sm:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search columns, descriptions, or types..."
                className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm text-gray-900 outline-none transition focus:border-cyan-500 dark:border-gray-700 dark:bg-gray-950 dark:text-white"
              />
            </label>
            <div className="flex gap-2">
              <button onClick={() => exportDictionary("json")} className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition hover:border-cyan-500 hover:text-cyan-600 dark:border-gray-700 dark:text-gray-200 dark:hover:border-cyan-500 dark:hover:text-cyan-300">
                <Download className="h-4 w-4" />
                JSON
              </button>
              <button onClick={() => exportDictionary("md")} className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition hover:border-cyan-500 hover:text-cyan-600 dark:border-gray-700 dark:text-gray-200 dark:hover:border-cyan-500 dark:hover:text-cyan-300">
                <FileText className="h-4 w-4" />
                Markdown
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { icon: Database, label: "Rows", value: formatNumber(rowCount) },
            { icon: Type, label: "Columns", value: formatNumber(columns.length) },
            { icon: Pencil, label: "Documented", value: formatNumber(documentedCount) },
            { icon: BarChart3, label: "Coverage", value: formatPercent(completeness) },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="rounded-xl border border-gray-200/70 bg-white/70 p-4 dark:border-gray-800 dark:bg-gray-950/40">
              <div className="mb-2 flex items-center gap-2 text-gray-500 dark:text-gray-400">
                <Icon className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-[0.16em]">{label}</span>
              </div>
              <p className="text-xl font-semibold text-gray-900 dark:text-white">{value}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {FILTERS.map((type) => {
            const active = filterType === type;
            const label = type === "all" ? "All" : TYPE_META[type].label;
            return (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${active ? "bg-cyan-600 text-white dark:bg-cyan-500" : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"}`}
              >
                {label} ({typeCounts[type]})
              </button>
            );
          })}
        </div>
      </motion.section>

      <div className="overflow-hidden rounded-2xl border border-gray-200/70 bg-white/90 shadow-sm dark:border-gray-800 dark:bg-gray-900/80">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
            <thead className="bg-gray-50/80 dark:bg-gray-950/60">
              <tr className="text-left text-xs uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
                <th className="w-10 px-4 py-3" />
                <th className="px-4 py-3">Column</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Sample</th>
                <th className="px-4 py-3">Statistics</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {filteredColumns.map((column, index) => {
                const isExpanded = expandedRows.includes(column.name);
                const stats = getStats(column, column.detectedType, rowCount);
                return (
                  <Fragment key={column.name}>
                    <motion.tr
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.02 }}
                      className="cursor-pointer transition hover:bg-cyan-50/60 dark:hover:bg-cyan-950/20"
                      onClick={() => toggleRow(column.name)}
                    >
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                        <ChevronRight className={`h-4 w-4 transition ${isExpanded ? "rotate-90 text-cyan-600 dark:text-cyan-400" : ""}`} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-1">
                          <p className="font-medium text-gray-900 dark:text-white">{column.name}</p>
                          <p className="max-w-xl text-sm text-gray-500 dark:text-gray-400">{column.description || "No description yet. Expand this row to document the column."}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3"><TypeBadge type={column.detectedType} /></td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{column.sampleValues.length ? formatValue(column.sampleValues[0]) : "—"}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                          {stats.slice(0, 3).map((item) => (
                            <span key={item.label} className="whitespace-nowrap">
                              <span className="text-gray-400 dark:text-gray-500">{item.label}:</span> {item.value}
                            </span>
                          ))}
                        </div>
                      </td>
                    </motion.tr>

                    <AnimatePresence initial={false}>
                      {isExpanded && (
                        <tr>
                          <td colSpan={5} className="bg-gray-50/70 px-4 py-0 dark:bg-gray-950/30">
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                              <div className="grid gap-4 py-4 lg:grid-cols-[1.1fr,0.9fr]">
                                <div className="space-y-3">
                                  <div className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
                                    <Pencil className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                                    Description
                                  </div>
                                  <textarea
                                    value={descriptions[column.name] ?? ""}
                                    onChange={(event) => updateDescription(column.name, event.target.value)}
                                    onClick={(event) => event.stopPropagation()}
                                    rows={4}
                                    placeholder={`Document what ${column.name} represents, business rules, and caveats.`}
                                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-cyan-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                                  />

                                  <div>
                                    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
                                      <Search className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                                      Sample Values
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                      {column.sampleValues.length ? column.sampleValues.slice(0, 8).map((value, valueIndex) => (
                                        <span key={`${column.name}-${valueIndex}`} className="rounded-full bg-gray-200/80 px-2.5 py-1 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                                          {formatValue(value)}
                                        </span>
                                      )) : <span className="text-sm text-gray-500 dark:text-gray-400">No samples available.</span>}
                                    </div>
                                  </div>
                                </div>

                                <div className="space-y-3">
                                  <div className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
                                    <BarChart3 className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                                    Statistics Summary
                                  </div>
                                  <div className="grid gap-2 sm:grid-cols-2">
                                    {stats.map((item) => (
                                      <div key={item.label} className="rounded-xl border border-gray-200/70 bg-white/80 px-3 py-2 dark:border-gray-800 dark:bg-gray-900/70">
                                        <p className="text-xs uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500">{item.label}</p>
                                        <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white">{item.value}</p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </motion.div>
                          </td>
                        </tr>
                      )}
                    </AnimatePresence>
                  </Fragment>
                );
              })}

              {!filteredColumns.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                    No columns match the current search or type filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
