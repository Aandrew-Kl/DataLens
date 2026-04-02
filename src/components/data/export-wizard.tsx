"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, FileText, FileJson, Database, Table2, Globe, Download,
  ChevronRight, ChevronLeft, Check, Columns3, Filter, Eye,
  Loader2, AlertCircle,
} from "lucide-react";
import type { ColumnProfile } from "@/types/dataset";
import { runQuery } from "@/lib/duckdb/client";
import { exportToCSV, exportToJSON, downloadFile } from "@/lib/utils/export";
import { formatBytes, formatNumber } from "@/lib/utils/formatters";

interface ExportWizardProps {
  open: boolean;
  onClose: () => void;
  tableName: string;
  columns: ColumnProfile[];
  rowCount: number;
}

type ExportFormat = "csv" | "json" | "sql" | "markdown" | "html";

const FORMAT_OPTIONS: { id: ExportFormat; label: string; desc: string; icon: React.ElementType; ext: string }[] = [
  { id: "csv", label: "CSV", desc: "Comma-separated values", icon: FileText, ext: "csv" },
  { id: "json", label: "JSON", desc: "Array of objects", icon: FileJson, ext: "json" },
  { id: "sql", label: "SQL INSERT", desc: "INSERT statements", icon: Database, ext: "sql" },
  { id: "markdown", label: "Markdown", desc: "Markdown table", icon: Table2, ext: "md" },
  { id: "html", label: "HTML Table", desc: "Standalone HTML", icon: Globe, ext: "html" },
];

const STEPS = [
  { label: "Format", icon: FileText },
  { label: "Columns", icon: Columns3 },
  { label: "Filters", icon: Filter },
  { label: "Preview", icon: Eye },
];

/* ---- Generators -------------------------------------------------- */

function generateSQL(table: string, cols: string[], rows: Record<string, unknown>[]): string {
  return rows.map((row) => {
    const vals = cols.map((c) => {
      const v = row[c];
      if (v === null || v === undefined) return "NULL";
      if (typeof v === "number") return String(v);
      return `'${String(v).replace(/'/g, "''")}'`;
    });
    return `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${vals.join(", ")});`;
  }).join("\n");
}

function generateMarkdown(cols: string[], rows: Record<string, unknown>[]): string {
  const hdr = `| ${cols.join(" | ")} |`;
  const sep = `| ${cols.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${cols.map((c) => String(r[c] ?? "")).join(" | ")} |`).join("\n");
  return [hdr, sep, body].join("\n");
}

function generateHTML(cols: string[], rows: Record<string, unknown>[]): string {
  const ths = cols.map((c) => `      <th>${c}</th>`).join("\n");
  const trs = rows.map((r) =>
    `    <tr>\n${cols.map((c) => `      <td>${String(r[c] ?? "")}</td>`).join("\n")}\n    </tr>`
  ).join("\n");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><title>Export</title>
<style>body{font-family:system-ui,sans-serif;padding:2rem;background:#0f172a;color:#e2e8f0}
table{border-collapse:collapse;width:100%}th,td{padding:8px 12px;border:1px solid #334155;text-align:left}
th{background:#1e293b;font-weight:600}tr:nth-child(even){background:#1e293b40}</style>
</head><body><table><thead><tr>\n${ths}\n</tr></thead><tbody>\n${trs}\n</tbody></table></body></html>`;
}

/* ---- Step indicator ----------------------------------------------- */

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-1 mb-6">
      {STEPS.map((s, i) => {
        const done = i < current;
        const active = i === current;
        const Icon = s.icon;
        return (
          <div key={s.label} className="flex items-center gap-1 flex-1">
            <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold shrink-0 transition-colors duration-200 ${done ? "bg-emerald-500 text-white" : active ? "bg-indigo-500 text-white ring-2 ring-indigo-500/30" : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500"}`}>
              {done ? <Check className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
            </div>
            <span className={`text-[11px] font-medium hidden sm:inline ${active ? "text-gray-900 dark:text-white" : "text-gray-400 dark:text-gray-500"}`}>
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-px mx-1 transition-colors duration-200 ${done ? "bg-emerald-500" : "bg-gray-200 dark:bg-gray-700"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---- Main component ---------------------------------------------- */

export default function ExportWizard({ open, onClose, tableName, columns, rowCount }: ExportWizardProps) {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(0);
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [selectedCols, setSelectedCols] = useState<Set<string>>(() => new Set(columns.map((c) => c.name)));
  const [rowLimit, setRowLimit] = useState("");
  const [whereClause, setWhereClause] = useState("");
  const [preview, setPreview] = useState<Record<string, unknown>[]>([]);
  const [totalExportRows, setTotalExportRows] = useState(rowCount);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStep(0); setFormat("csv"); setRowLimit(""); setWhereClause("");
      setSelectedCols(new Set(columns.map((c) => c.name)));
      setPreview([]); setTotalExportRows(rowCount); setError(null);
    }
  }, [open, columns, rowCount]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onClose]);

  const buildQuery = useCallback((limit?: number) => {
    const cols = [...selectedCols].map((c) => `"${c}"`).join(", ");
    let sql = `SELECT ${cols} FROM "${tableName}"`;
    if (whereClause.trim()) sql += ` WHERE ${whereClause.trim()}`;
    const eff = limit ?? (rowLimit ? parseInt(rowLimit, 10) : null);
    if (eff && eff > 0) sql += ` LIMIT ${eff}`;
    return sql;
  }, [selectedCols, tableName, whereClause, rowLimit]);

  const fetchPreview = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setPreview(await runQuery(buildQuery(5)));
      const cSql = `SELECT COUNT(*) as cnt FROM "${tableName}"${whereClause.trim() ? ` WHERE ${whereClause.trim()}` : ""}`;
      const total = Number((await runQuery(cSql))[0]?.cnt ?? 0);
      const lim = rowLimit ? parseInt(rowLimit, 10) : null;
      setTotalExportRows(lim && lim > 0 ? Math.min(lim, total) : total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Query failed"); setPreview([]);
    } finally { setLoading(false); }
  }, [buildQuery, tableName, whereClause, rowLimit]);

  const sizeEstimate = useMemo(() => {
    const avg = format === "json" ? 24 : format === "sql" ? 30 : 12;
    return totalExportRows * selectedCols.size * avg;
  }, [totalExportRows, selectedCols.size, format]);

  const toggleCol = (name: string) => {
    setSelectedCols((prev) => { const n = new Set(prev); if (n.has(name)) { n.delete(name); } else { n.add(name); } return n; });
  };
  const selectAll = () => setSelectedCols(new Set(columns.map((c) => c.name)));
  const selectNone = () => setSelectedCols(new Set());

  const canNext = step === 0 || (step === 1 && selectedCols.size > 0) || step === 2 || step === 3;

  const goForward = async () => {
    setDirection(1);
    if (step === 2) await fetchPreview();
    setStep((s) => Math.min(s + 1, 3));
  };
  const goBackward = () => { setDirection(-1); setStep((s) => Math.max(s - 1, 0)); };

  const handleDownload = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const rows = await runQuery(buildQuery());
      const colNames = [...selectedCols];
      const fileName = `${tableName}.${FORMAT_OPTIONS.find((f) => f.id === format)!.ext}`;
      switch (format) {
        case "csv": exportToCSV(rows, fileName); break;
        case "json": exportToJSON(rows, fileName); break;
        case "sql": downloadFile(generateSQL(tableName, colNames, rows), fileName, "text/sql"); break;
        case "markdown": downloadFile(generateMarkdown(colNames, rows), fileName, "text/markdown"); break;
        case "html": downloadFile(generateHTML(colNames, rows), fileName, "text/html"); break;
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally { setLoading(false); }
  }, [buildQuery, format, selectedCols, tableName, onClose]);

  const slideVariants = {
    enter: (d: number) => ({ x: d > 0 ? 80 : -80, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (d: number) => ({ x: d > 0 ? -80 : 80, opacity: 0 }),
  };

  const previewCols = preview.length > 0 ? [...selectedCols] : [];

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />

          <motion.div
            className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl border border-gray-200/50 dark:border-gray-700/50 shadow-xl overflow-hidden"
            initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.92 }}
            transition={{ duration: 0.2, ease: "easeOut" }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Export Wizard"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-0 shrink-0">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Export Data</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{tableName} &middot; {formatNumber(rowCount)} rows</p>
              </div>
              <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors duration-150" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <StepIndicator current={step} />

              <AnimatePresence mode="wait" custom={direction}>
                <motion.div key={step} custom={direction} variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.2, ease: "easeInOut" }}>

                  {/* Step 0 -- Format */}
                  {step === 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {FORMAT_OPTIONS.map((opt) => {
                        const active = format === opt.id;
                        const Icon = opt.icon;
                        return (
                          <button key={opt.id} onClick={() => setFormat(opt.id)} className={`flex items-center gap-3 p-4 rounded-xl border text-left transition-all duration-150 ${active ? "border-indigo-400 dark:border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/40 ring-1 ring-indigo-400/30" : "border-gray-200/60 dark:border-gray-700/50 hover:border-gray-300 dark:hover:border-gray-600 bg-white/60 dark:bg-gray-800/40"}`}>
                            <div className={`p-2 rounded-lg ${active ? "bg-indigo-100 dark:bg-indigo-900/50" : "bg-gray-100 dark:bg-gray-800"}`}>
                              <Icon className={`w-4 h-4 ${active ? "text-indigo-600 dark:text-indigo-400" : "text-gray-500 dark:text-gray-400"}`} />
                            </div>
                            <div>
                              <p className={`text-sm font-medium ${active ? "text-indigo-700 dark:text-indigo-300" : "text-gray-800 dark:text-gray-200"}`}>{opt.label}</p>
                              <p className="text-[11px] text-gray-500 dark:text-gray-400">{opt.desc}</p>
                            </div>
                            {active && <Check className="w-4 h-4 text-indigo-500 ml-auto shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Step 1 -- Columns */}
                  {step === 1 && (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400">{selectedCols.size} of {columns.length} columns selected</p>
                        <div className="flex gap-2">
                          <button onClick={selectAll} className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline">Select all</button>
                          <button onClick={selectNone} className="text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:underline">Select none</button>
                        </div>
                      </div>
                      <div className="max-h-64 overflow-y-auto rounded-xl border border-gray-200/60 dark:border-gray-700/50 divide-y divide-gray-100 dark:divide-gray-800">
                        {columns.map((col) => (
                          <label key={col.name} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                            <input type="checkbox" checked={selectedCols.has(col.name)} onChange={() => toggleCol(col.name)} className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500" />
                            <span className="text-sm text-gray-800 dark:text-gray-200 font-medium truncate">{col.name}</span>
                            <span className="ml-auto text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 font-semibold">{col.type}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Step 2 -- Filters */}
                  {step === 2 && (
                    <div className="space-y-5">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">Row limit</label>
                        <input type="number" min={0} placeholder={`All rows (${formatNumber(rowCount)})`} value={rowLimit} onChange={(e) => setRowLimit(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-colors" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                          WHERE clause <span className="text-gray-400 dark:text-gray-500">(optional)</span>
                        </label>
                        <input type="text" placeholder="e.g. age > 30 AND status = 'active'" value={whereClause} onChange={(e) => setWhereClause(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm font-mono bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-colors" />
                        <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">Standard SQL syntax. Column names with spaces need double quotes.</p>
                      </div>
                    </div>
                  )}

                  {/* Step 3 -- Preview & Download */}
                  {step === 3 && (
                    <div className="space-y-4">
                      <div className="flex flex-wrap gap-2">
                        {[FORMAT_OPTIONS.find((f) => f.id === format)!.label, `${selectedCols.size} columns`, `${formatNumber(totalExportRows)} rows`].map((t) => (
                          <span key={t} className="inline-flex items-center px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 text-xs font-medium text-gray-600 dark:text-gray-300">{t}</span>
                        ))}
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-xs font-medium text-indigo-600 dark:text-indigo-400">~{formatBytes(sizeEstimate)}</span>
                      </div>

                      {error && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 text-xs">
                          <AlertCircle className="w-4 h-4 shrink-0" />{error}
                        </div>
                      )}

                      {loading ? (
                        <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 text-indigo-500 animate-spin" /></div>
                      ) : preview.length > 0 ? (
                        <div className="rounded-xl border border-gray-200/60 dark:border-gray-700/50 overflow-auto max-h-56">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-gray-50 dark:bg-gray-800/60">
                                {previewCols.map((col) => (
                                  <th key={col} className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">{col}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                              {preview.map((row, ri) => (
                                <tr key={ri} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                                  {previewCols.map((col) => (
                                    <td key={col} className="px-3 py-1.5 font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap max-w-[200px] truncate">
                                      {row[col] === null ? <span className="italic text-gray-400">null</span> : String(row[col])}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : !error && (
                        <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-6">No rows match the current filters</p>
                      )}
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200/60 dark:border-gray-700/50 shrink-0 bg-gray-50/50 dark:bg-gray-800/30">
              <button onClick={goBackward} disabled={step === 0} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${step === 0 ? "text-gray-300 dark:text-gray-600 cursor-not-allowed" : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"}`}>
                <ChevronLeft className="w-4 h-4" />Back
              </button>

              {step < 3 ? (
                <button onClick={goForward} disabled={!canNext} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${canNext ? "bg-indigo-600 hover:bg-indigo-700 text-white" : "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed"}`}>
                  Next<ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <button onClick={handleDownload} disabled={loading || preview.length === 0} className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-colors ${loading || preview.length === 0 ? "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed" : "bg-emerald-600 hover:bg-emerald-700 text-white"}`}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}Download
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
