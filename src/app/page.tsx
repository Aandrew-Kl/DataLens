"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Database,
  Table,
  BarChart3,
  MessageSquare,
  Upload,
  Moon,
  Sun,
  ExternalLink,
  Rows3,
  Columns3,
  X,
} from "lucide-react";

import { loadCSVIntoDB, runQuery, getTableRowCount } from "@/lib/duckdb/client";
import { profileTable } from "@/lib/duckdb/profiler";
import { useDatasetStore } from "@/stores/dataset-store";
import { useUIStore } from "@/stores/ui-store";
import {
  formatNumber,
  formatBytes,
  sanitizeTableName,
  generateId,
} from "@/lib/utils/formatters";
import type { DatasetMeta, ColumnProfile } from "@/types/dataset";
import type { ChartConfig, MetricCard, DashboardConfig } from "@/types/chart";

// Lazy imports for components — these will be created separately.
// Using inline implementations for the core page so it works standalone.

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type AppTab = "profile" | "dashboard" | "query";

interface FileDropResult {
  fileName: string;
  csvContent: string;
  sizeBytes: number;
}

// ─────────────────────────────────────────────
// FileDropzone (inline component)
// ─────────────────────────────────────────────

function FileDropzone({
  onFileLoaded,
}: {
  onFileLoaded: (result: FileDropResult) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    async (file: File) => {
      setIsProcessing(true);
      setError(null);
      try {
        const ext = file.name.split(".").pop()?.toLowerCase() || "";
        let csvContent: string;

        if (ext === "csv" || ext === "tsv") {
          csvContent = await file.text();
        } else if (ext === "json") {
          const text = await file.text();
          const data = JSON.parse(text);
          const rows = Array.isArray(data) ? data : [data];
          if (rows.length === 0) throw new Error("Empty JSON data");
          const headers = Object.keys(rows[0]);
          const csvLines = [
            headers.join(","),
            ...rows.map((row) =>
              headers
                .map((h) => {
                  const val = row[h];
                  if (val === null || val === undefined) return "";
                  const str = String(val);
                  return str.includes(",") || str.includes('"') || str.includes("\n")
                    ? `"${str.replace(/"/g, '""')}"`
                    : str;
                })
                .join(",")
            ),
          ];
          csvContent = csvLines.join("\n");
        } else if (ext === "xlsx" || ext === "xls") {
          const { read, utils } = await import("xlsx");
          const buffer = await file.arrayBuffer();
          const wb = read(buffer, { type: "array" });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          csvContent = utils.sheet_to_csv(sheet);
        } else {
          throw new Error(`Unsupported file type: .${ext}`);
        }

        onFileLoaded({
          fileName: file.name,
          csvContent,
          sizeBytes: file.size,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to process file");
      } finally {
        setIsProcessing(false);
      }
    },
    [onFileLoaded]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  return (
    <div className="w-full max-w-xl mx-auto">
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") handleClick();
        }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`
          relative flex flex-col items-center justify-center gap-4
          rounded-2xl border-2 border-dashed p-12
          transition-all duration-300 cursor-pointer
          ${
            isDragging
              ? "border-primary bg-primary/5 scale-[1.02] shadow-lg shadow-primary/10"
              : "border-slate-300 dark:border-slate-600 hover:border-primary/50 hover:bg-primary/[0.02]"
          }
          ${isProcessing ? "pointer-events-none opacity-70" : ""}
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv,.json,.xlsx,.xls"
          onChange={handleInputChange}
          className="hidden"
        />

        <div
          className={`rounded-xl p-4 ${
            isDragging
              ? "bg-primary/10 text-primary"
              : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
          } transition-colors`}
        >
          {isProcessing ? (
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          ) : (
            <Upload className="h-8 w-8" />
          )}
        </div>

        <div className="text-center">
          <p className="text-base font-medium text-slate-700 dark:text-slate-300">
            {isProcessing
              ? "Processing file..."
              : isDragging
              ? "Drop it here"
              : "Drop a CSV, Excel, or JSON file"}
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-500">
            or click to browse
          </p>
        </div>
      </div>

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 rounded-lg border border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-400"
        >
          {error}
        </motion.div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// DataProfiler (inline component)
// ─────────────────────────────────────────────

function DataProfiler({ columns }: { columns: ColumnProfile[] }) {
  const typeColors: Record<string, string> = {
    string:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    number:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    date: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    boolean:
      "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    unknown:
      "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400",
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {columns.map((col) => (
        <div
          key={col.name}
          className="glass rounded-xl p-4 space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-medium text-sm text-slate-900 dark:text-slate-100 truncate">
              {col.name}
            </h4>
            <span
              className={`shrink-0 text-xs font-mono px-2 py-0.5 rounded-full ${
                typeColors[col.type] || typeColors.unknown
              }`}
            >
              {col.type}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-slate-500 dark:text-slate-500">Unique</span>
              <p className="font-medium text-slate-800 dark:text-slate-200">
                {formatNumber(col.uniqueCount)}
              </p>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-500">Nulls</span>
              <p className="font-medium text-slate-800 dark:text-slate-200">
                {formatNumber(col.nullCount)}
              </p>
            </div>
            {col.type === "number" && col.mean !== undefined && (
              <>
                <div>
                  <span className="text-slate-500 dark:text-slate-500">Mean</span>
                  <p className="font-medium text-slate-800 dark:text-slate-200">
                    {formatNumber(col.mean)}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-500">Median</span>
                  <p className="font-medium text-slate-800 dark:text-slate-200">
                    {col.median !== undefined ? formatNumber(col.median) : "—"}
                  </p>
                </div>
              </>
            )}
            {col.min !== undefined && (
              <>
                <div>
                  <span className="text-slate-500 dark:text-slate-500">Min</span>
                  <p className="font-medium text-slate-800 dark:text-slate-200 truncate">
                    {typeof col.min === "number" ? formatNumber(col.min) : col.min}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-500">Max</span>
                  <p className="font-medium text-slate-800 dark:text-slate-200 truncate">
                    {typeof col.max === "number" ? formatNumber(col.max) : col.max}
                  </p>
                </div>
              </>
            )}
          </div>

          {col.sampleValues.length > 0 && (
            <div>
              <span className="text-xs text-slate-500 dark:text-slate-500">
                Sample values
              </span>
              <div className="mt-1 flex flex-wrap gap-1">
                {col.sampleValues.slice(0, 3).map((val, i) => (
                  <span
                    key={i}
                    className="inline-block max-w-[120px] truncate rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-xs font-mono text-slate-600 dark:text-slate-400"
                  >
                    {String(val)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// DataTable (inline component)
// ─────────────────────────────────────────────

function DataTable({
  tableName,
  columns,
}: {
  tableName: string;
  columns: ColumnProfile[];
}) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await runQuery(
          `SELECT * FROM "${tableName}" LIMIT 100`
        );
        if (!cancelled) setRows(data);
      } catch (err) {
        console.error("Failed to load table data:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tableName]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-slate-500">No data to display.</p>
    );
  }

  const colNames = columns.map((c) => c.name);

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="bg-slate-50 dark:bg-slate-800/60">
            {colNames.map((name) => (
              <th
                key={name}
                className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider"
              >
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((row, i) => (
            <tr
              key={i}
              className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"
            >
              {colNames.map((name) => (
                <td
                  key={name}
                  className="whitespace-nowrap px-4 py-2 text-slate-700 dark:text-slate-300 font-mono text-xs max-w-[200px] truncate"
                >
                  {row[name] === null || row[name] === undefined
                    ? <span className="text-slate-400 italic">null</span>
                    : String(row[name])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────
// DashboardView (inline component)
// ─────────────────────────────────────────────

function DashboardView({
  dataset,
  columns,
}: {
  dataset: DatasetMeta;
  columns: ColumnProfile[];
}) {
  const [dashboardConfig, setDashboardConfig] = useState<DashboardConfig | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chartData, setChartData] = useState<
    Record<string, Record<string, unknown>[]>
  >({});
  const hasFetched = useRef(false);

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/ai/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "dashboard",
            tableName: sanitizeTableName(dataset.fileName),
            columns,
            rowCount: dataset.rowCount,
          }),
        });

        if (!res.ok) throw new Error("Failed to generate dashboard");

        const config: DashboardConfig = await res.json();
        setDashboardConfig(config);

        // Execute SQL for each chart to get the data
        const dataMap: Record<string, Record<string, unknown>[]> = {};
        for (const chart of config.charts) {
          if (chart.xAxis && chart.yAxis) {
            try {
              const tableName = sanitizeTableName(dataset.fileName);
              const agg = chart.aggregation || "sum";
              const sql = `SELECT "${chart.xAxis}" AS x, ${agg}("${chart.yAxis}") AS y FROM "${tableName}" GROUP BY "${chart.xAxis}" ORDER BY y DESC LIMIT 20`;
              const result = await runQuery(sql);
              dataMap[chart.id] = result;
            } catch {
              dataMap[chart.id] = [];
            }
          }
        }
        setChartData(dataMap);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to generate dashboard. Is Ollama running?"
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [dataset, columns]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Generating dashboard with AI...
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          This requires Ollama to be running locally
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30 px-5 py-4 text-sm text-amber-700 dark:text-amber-400 max-w-md text-center">
          <p className="font-medium mb-1">Could not generate dashboard</p>
          <p className="text-xs">{error}</p>
        </div>
        <button
          onClick={() => {
            hasFetched.current = false;
            setError(null);
            setLoading(true);
            // Re-trigger effect
            setDashboardConfig(null);
          }}
          className="text-sm text-primary hover:text-primary-dark transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!dashboardConfig) return null;

  return (
    <div className="space-y-6">
      {/* Metric cards */}
      {dashboardConfig.metrics.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {dashboardConfig.metrics.map((metric, i) => (
            <div key={i} className="glass rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">{metric.emoji}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  {metric.label}
                </span>
              </div>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">
                {typeof metric.value === "number"
                  ? formatNumber(metric.value)
                  : metric.value}
              </p>
              {metric.change && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {metric.change}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Charts */}
      {dashboardConfig.charts.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {dashboardConfig.charts.map((chart) => (
            <div key={chart.id} className="glass rounded-xl p-5">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">
                {chart.title}
              </h3>
              {chartData[chart.id] && chartData[chart.id].length > 0 ? (
                <div className="space-y-2">
                  {chartData[chart.id].slice(0, 8).map((row, i) => {
                    const values = chartData[chart.id].map((r) =>
                      Number(r.y) || 0
                    );
                    const maxVal = Math.max(...values, 1);
                    const barWidth =
                      ((Number(row.y) || 0) / maxVal) * 100;

                    return (
                      <div key={i} className="flex items-center gap-3">
                        <span className="w-24 truncate text-xs text-slate-600 dark:text-slate-400 text-right shrink-0">
                          {String(row.x)}
                        </span>
                        <div className="flex-1 h-5 bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
                          <div
                            className="h-full rounded bg-gradient-to-r from-primary to-primary-light transition-all duration-500"
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                        <span className="w-16 text-xs text-slate-700 dark:text-slate-300 font-mono text-right shrink-0">
                          {formatNumber(Number(row.y) || 0)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-slate-400 text-center py-4">
                  No data for this chart
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {dashboardConfig.metrics.length === 0 &&
        dashboardConfig.charts.length === 0 && (
          <div className="text-center py-12 text-sm text-slate-500">
            No dashboard suggestions were generated. Try loading a dataset with
            more varied data.
          </div>
        )}
    </div>
  );
}

// ─────────────────────────────────────────────
// ChatInterface (inline component)
// ─────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sql?: string;
  data?: Record<string, unknown>[];
  error?: string;
}

function ChatInterface({ dataset }: { dataset: DatasetMeta }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const question = input.trim();
    if (!question || isLoading) return;

    const userMsg: ChatMessage = {
      id: generateId(),
      role: "user",
      content: question,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const tableName = sanitizeTableName(dataset.fileName);
      const res = await fetch("/api/ai/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          datasetId: dataset.id,
          tableName,
          columns: dataset.columns,
          rowCount: dataset.rowCount,
        }),
      });

      if (!res.ok) throw new Error("Query failed");

      const result = await res.json();
      const sql = result.sql as string;

      // Execute the SQL client-side
      let data: Record<string, unknown>[] = [];
      let queryError: string | undefined;
      try {
        data = await runQuery(sql);
      } catch (err) {
        queryError =
          err instanceof Error ? err.message : "SQL execution failed";
      }

      const assistantMsg: ChatMessage = {
        id: generateId(),
        role: "assistant",
        content: result.summary || `Query returned ${data.length} rows.`,
        sql,
        data: queryError ? undefined : data.slice(0, 50),
        error: queryError,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: generateId(),
        role: "assistant",
        content: "Sorry, I could not process that question. Is Ollama running?",
        error: err instanceof Error ? err.message : "Unknown error",
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[500px]">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto space-y-4 p-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3">
            <MessageSquare className="h-10 w-10 text-slate-300 dark:text-slate-600" />
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Ask a question about your data in plain English
            </p>
            <div className="flex flex-wrap gap-2 justify-center mt-2">
              {[
                "How many rows are there?",
                "Show the top 10 records",
                "What are the unique values?",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => setInput(q)}
                  className="text-xs px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-primary/10 hover:text-primary transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${
              msg.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-[80%] rounded-xl px-4 py-3 text-sm ${
                msg.role === "user"
                  ? "bg-primary text-white"
                  : "glass text-slate-800 dark:text-slate-200"
              }`}
            >
              <p>{msg.content}</p>

              {msg.sql && (
                <pre className="mt-2 rounded-lg bg-slate-900 dark:bg-black/40 p-3 text-xs text-slate-300 overflow-x-auto font-mono">
                  {msg.sql}
                </pre>
              )}

              {msg.error && (
                <p className="mt-2 text-xs text-red-500">{msg.error}</p>
              )}

              {msg.data && msg.data.length > 0 && (
                <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-800/60">
                        {Object.keys(msg.data[0]).map((key) => (
                          <th
                            key={key}
                            className="px-3 py-1.5 text-left text-xs font-semibold text-slate-500 uppercase"
                          >
                            {key}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {msg.data.slice(0, 10).map((row, i) => (
                        <tr key={i}>
                          {Object.values(row).map((val, j) => (
                            <td
                              key={j}
                              className="px-3 py-1.5 font-mono text-slate-700 dark:text-slate-300"
                            >
                              {val === null ? (
                                <span className="italic text-slate-400">
                                  null
                                </span>
                              ) : (
                                String(val)
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {msg.data.length > 10 && (
                    <p className="px-3 py-2 text-xs text-slate-400 border-t border-slate-100 dark:border-slate-800">
                      Showing 10 of {msg.data.length} rows
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="glass rounded-xl px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                <div
                  className="h-2 w-2 rounded-full bg-primary animate-pulse"
                  style={{ animationDelay: "150ms" }}
                />
                <div
                  className="h-2 w-2 rounded-full bg-primary animate-pulse"
                  style={{ animationDelay: "300ms" }}
                />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <form
        onSubmit={handleSubmit}
        className="border-t border-slate-200 dark:border-slate-700 p-4"
      >
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question about your data..."
            disabled={isLoading}
            className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="shrink-0 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────
// Tab config
// ─────────────────────────────────────────────

const TABS: { id: AppTab; label: string; icon: typeof Database }[] = [
  { id: "profile", label: "Profile", icon: Table },
  { id: "dashboard", label: "Dashboard", icon: BarChart3 },
  { id: "query", label: "Query", icon: MessageSquare },
];

// ─────────────────────────────────────────────
// Feature badges for landing page
// ─────────────────────────────────────────────

const FEATURES = [
  { label: "DuckDB-WASM", icon: Database },
  { label: "Ollama", icon: MessageSquare },
  { label: "100% Private", icon: Table },
  { label: "Zero Cost", icon: BarChart3 },
];

// ─────────────────────────────────────────────
// Main Page Component
// ─────────────────────────────────────────────

export default function Home() {
  const { theme, toggleTheme } = useUIStore();
  const { addDataset, getActiveDataset, setActiveDataset } = useDatasetStore();
  const activeDataset = useDatasetStore((s) => {
    return s.datasets.find((d) => d.id === s.activeDatasetId);
  });

  const [activeTab, setActiveTab] = useState<AppTab>("profile");
  const [profileData, setProfileData] = useState<ColumnProfile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Initialize theme from system preference on mount
  useEffect(() => {
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches;
    const stored = localStorage.getItem("datalens-theme");
    const initial = stored === "dark" || (!stored && prefersDark) ? "dark" : "light";
    useUIStore.getState().setTheme(initial);
  }, []);

  const handleFileLoaded = useCallback(
    async (result: FileDropResult) => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const tableName = sanitizeTableName(result.fileName);

        // 1. Load CSV into DuckDB
        await loadCSVIntoDB(tableName, result.csvContent);

        // 2. Profile the table
        const columns = await profileTable(tableName);

        // 3. Get row count
        const rowCount = await getTableRowCount(tableName);

        // 4. Create dataset metadata
        const meta: DatasetMeta = {
          id: generateId(),
          name: tableName,
          fileName: result.fileName,
          rowCount,
          columnCount: columns.length,
          columns,
          uploadedAt: Date.now(),
          sizeBytes: result.sizeBytes,
        };

        // 5. Store in state
        addDataset(meta);
        setProfileData(columns);
        setActiveTab("profile");
      } catch (err) {
        console.error("Failed to load dataset:", err);
        setLoadError(
          err instanceof Error ? err.message : "Failed to load dataset"
        );
      } finally {
        setIsLoading(false);
      }
    },
    [addDataset]
  );

  const handleNewDataset = useCallback(() => {
    setActiveDataset(null);
    setProfileData([]);
    setActiveTab("profile");
    setLoadError(null);
  }, [setActiveDataset]);

  // ─── State A: Landing / Drop state ───

  if (!activeDataset) {
    return (
      <div className="flex flex-1 flex-col min-h-screen">
        {/* Top bar */}
        <header className="flex items-center justify-end gap-2 px-6 py-4">
          <a
            href="https://github.com/datalens-dev/datalens"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg p-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="View on GitHub"
          >
            <ExternalLink className="h-5 w-5" />
          </a>
          <button
            onClick={toggleTheme}
            className="rounded-lg p-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Toggle dark mode"
          >
            {theme === "dark" ? (
              <Sun className="h-5 w-5" />
            ) : (
              <Moon className="h-5 w-5" />
            )}
          </button>
        </header>

        {/* Hero section */}
        <main className="flex flex-1 flex-col items-center justify-center px-6 pb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="w-full max-w-2xl text-center space-y-8"
          >
            {/* Branding */}
            <div className="space-y-4">
              <div className="inline-flex items-center gap-3 mb-2">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent shadow-lg shadow-primary/20">
                  <Database className="h-6 w-6 text-white" />
                </div>
                <h1 className="text-4xl font-bold tracking-tight text-slate-900 dark:text-white">
                  DataLens
                </h1>
              </div>
              <p className="text-xl font-medium text-slate-700 dark:text-slate-200">
                Drop a file. Ask anything. See everything.
              </p>
              <p className="text-base text-slate-500 dark:text-slate-400 max-w-lg mx-auto">
                Open source AI-powered data explorer. No SQL needed. Runs 100%
                locally.
              </p>
            </div>

            {/* File drop zone */}
            <FileDropzone onFileLoaded={handleFileLoaded} />

            {/* Loading overlay */}
            {isLoading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center justify-center gap-3 text-sm text-slate-500"
              >
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                Loading and profiling data...
              </motion.div>
            )}

            {/* Load error */}
            {loadError && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-400"
              >
                {loadError}
              </motion.div>
            )}

            {/* Feature badges */}
            <div className="flex flex-wrap items-center justify-center gap-3 pt-4">
              {FEATURES.map((feat) => (
                <div
                  key={feat.label}
                  className="flex items-center gap-2 rounded-full border border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-800/50 px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400"
                >
                  <feat.icon className="h-3.5 w-3.5" />
                  {feat.label}
                </div>
              ))}
            </div>
          </motion.div>
        </main>
      </div>
    );
  }

  // ─── State B: Workspace state ───

  const tableName = sanitizeTableName(activeDataset.fileName);

  return (
    <div className="flex flex-1 flex-col min-h-screen">
      {/* Top bar */}
      <header className="sticky top-0 z-30 glass border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between px-6 py-3">
          {/* Left: dataset info */}
          <div className="flex items-center gap-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent">
              <Database className="h-4 w-4 text-white" />
            </div>
            <div className="flex items-center gap-3">
              <h1 className="text-sm font-semibold text-slate-900 dark:text-white">
                {activeDataset.fileName}
              </h1>
              <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="inline-flex items-center gap-1">
                  <Rows3 className="h-3 w-3" />
                  {formatNumber(activeDataset.rowCount)} rows
                </span>
                <span className="text-slate-300 dark:text-slate-600">|</span>
                <span className="inline-flex items-center gap-1">
                  <Columns3 className="h-3 w-3" />
                  {activeDataset.columnCount} cols
                </span>
                <span className="text-slate-300 dark:text-slate-600">|</span>
                <span>{formatBytes(activeDataset.sizeBytes)}</span>
              </div>
            </div>
          </div>

          {/* Right: actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleNewDataset}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              <Upload className="h-3.5 w-3.5" />
              New Dataset
            </button>
            <button
              onClick={toggleTheme}
              className="rounded-lg p-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label="Toggle dark mode"
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        {/* Tab navigation */}
        <div className="flex px-6 gap-1 -mb-px">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex items-center gap-2 px-4 py-2.5 text-sm font-medium
                  border-b-2 transition-colors
                  ${
                    isActive
                      ? "border-primary text-primary"
                      : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600"
                  }
                `}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Tab content */}
      <main className="flex-1 px-6 py-6">
        <AnimatePresence mode="wait">
          {activeTab === "profile" && (
            <motion.div
              key="profile"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                  Column Profiles
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Automated data profiling for {profileData.length} columns
                </p>
              </div>
              <DataProfiler columns={profileData} />

              <div className="pt-4">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                  Data Preview
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                  First 100 rows
                </p>
                <DataTable tableName={tableName} columns={profileData} />
              </div>
            </motion.div>
          )}

          {activeTab === "dashboard" && (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                  Auto-Generated Dashboard
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  AI-suggested metrics and visualizations
                </p>
              </div>
              <DashboardView dataset={activeDataset} columns={profileData} />
            </motion.div>
          )}

          {activeTab === "query" && (
            <motion.div
              key="query"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.2 }}
              className="max-w-3xl mx-auto"
            >
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                  Ask Your Data
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Natural language queries powered by AI
                </p>
              </div>
              <div className="glass rounded-xl overflow-hidden">
                <ChatInterface dataset={activeDataset} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
