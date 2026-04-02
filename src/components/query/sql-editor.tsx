"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type KeyboardEvent,
  type ChangeEvent,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play,
  Copy,
  Trash2,
  History,
  ChevronDown,
  Table2,
  Clock,
  AlertCircle,
  Check,
  Code2,
  Loader2,
} from "lucide-react";
import type { ColumnProfile } from "@/types/dataset";
import { highlightSQL } from "@/lib/utils/sql-highlight";
import { runQuery } from "@/lib/duckdb/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QueryResult {
  data: Record<string, unknown>[];
  columns: string[];
  sql: string;
  executionTimeMs: number;
}

interface HistoryEntry {
  sql: string;
  timestamp: number;
  rowCount: number;
  executionTimeMs: number;
  error?: string;
}

interface SQLEditorProps {
  tableName: string;
  columns: ColumnProfile[];
  onQueryResult?: (result: QueryResult) => void;
  defaultSQL?: string;
}

// ---------------------------------------------------------------------------
// Token color map
// ---------------------------------------------------------------------------

const TOKEN_CLASS: Record<string, string> = {
  keyword: "text-blue-500 dark:text-blue-400",
  function: "text-purple-500 dark:text-purple-400",
  string: "text-green-500 dark:text-green-400",
  number: "text-orange-500 dark:text-orange-400",
  operator: "text-red-400 dark:text-red-500",
  identifier: "text-cyan-500 dark:text-cyan-400",
  comment: "text-gray-400 dark:text-gray-500 italic",
  plain: "text-gray-800 dark:text-gray-200",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LINE_HEIGHT = 20; // px per line
const MIN_LINES = 3;
const MAX_LINES = 20;

function computeEditorHeight(text: string): number {
  const lineCount = Math.max(MIN_LINES, Math.min(MAX_LINES, text.split("\n").length));
  return lineCount * LINE_HEIGHT + 16; // 16px vertical padding
}

function formatSQL(sql: string): string {
  const clauseKeywords = [
    "SELECT",
    "FROM",
    "WHERE",
    "GROUP BY",
    "ORDER BY",
    "HAVING",
    "LIMIT",
    "LEFT JOIN",
    "RIGHT JOIN",
    "INNER JOIN",
    "OUTER JOIN",
    "FULL JOIN",
    "CROSS JOIN",
    "JOIN",
    "ON",
    "SET",
    "VALUES",
    "INTO",
    "INSERT",
    "UPDATE",
    "DELETE",
    "WITH",
    "UNION",
    "INTERSECT",
    "EXCEPT",
    "OFFSET",
  ];

  // Normalize whitespace first
  let formatted = sql.replace(/\s+/g, " ").trim();

  // Uppercase keywords via tokenizer
  const tokens = highlightSQL(formatted);
  formatted = tokens
    .map((t) => (t.type === "keyword" || t.type === "function" ? t.text.toUpperCase() : t.text))
    .join("");

  // Add newlines before major clauses
  for (const kw of clauseKeywords) {
    const regex = new RegExp(`\\s+${kw}\\b`, "gi");
    formatted = formatted.replace(regex, `\n${kw}`);
  }

  return formatted.trim();
}

function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/i.test(navigator.userAgent);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function HighlightedCode({ sql }: { sql: string }) {
  const tokens = useMemo(() => highlightSQL(sql), [sql]);

  return (
    <>
      {tokens.map((token, i) => (
        <span key={i} className={TOKEN_CLASS[token.type] ?? TOKEN_CLASS.plain}>
          {token.text}
        </span>
      ))}
      {/* Trailing newline so the pre matches textarea height */}
      {"\n"}
    </>
  );
}

function LineNumbers({ count }: { count: number }) {
  return (
    <div
      className="select-none text-right pr-3 pt-2 pb-2 text-xs leading-[20px] text-gray-400 dark:text-gray-600 font-mono border-r border-gray-200/40 dark:border-gray-700/30 min-w-[2.5rem]"
      aria-hidden
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>{i + 1}</div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function SQLEditor({
  tableName,
  columns,
  onQueryResult,
  defaultSQL,
}: SQLEditorProps) {
  // Editor state
  const [sql, setSQL] = useState(
    defaultSQL ?? `SELECT *\nFROM "${tableName}"\nLIMIT 100;`
  );
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<QueryResult | null>(null);
  const [copiedSQL, setCopiedSQL] = useState(false);

  // History
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Schema panel
  const [showSchema, setShowSchema] = useState(false);

  // Refs
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);

  // Derived
  const lineCount = sql.split("\n").length;
  const editorHeight = computeEditorHeight(sql);

  // -------------------------------------------------------------------------
  // Sync scroll between textarea and pre
  // -------------------------------------------------------------------------

  const handleScroll = useCallback(() => {
    if (textareaRef.current && preRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop;
      preRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  // -------------------------------------------------------------------------
  // Close dropdowns on outside click
  // -------------------------------------------------------------------------

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // -------------------------------------------------------------------------
  // Execute query
  // -------------------------------------------------------------------------

  const executeQuery = useCallback(async () => {
    const trimmed = sql.trim();
    if (!trimmed || isExecuting) return;

    setIsExecuting(true);
    setError(null);
    setLastResult(null);

    const startTime = performance.now();

    try {
      const data = await runQuery(trimmed);
      const executionTimeMs = Math.round(performance.now() - startTime);
      const resultColumns = data.length > 0 ? Object.keys(data[0]) : [];

      const result: QueryResult = {
        data,
        columns: resultColumns,
        sql: trimmed,
        executionTimeMs,
      };

      setLastResult(result);
      onQueryResult?.(result);

      // Add to history (keep last 10)
      setHistory((prev) => {
        const entry: HistoryEntry = {
          sql: trimmed,
          timestamp: Date.now(),
          rowCount: data.length,
          executionTimeMs,
        };
        return [entry, ...prev].slice(0, 10);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Query execution failed";
      setError(message);

      setHistory((prev) => {
        const entry: HistoryEntry = {
          sql: trimmed,
          timestamp: Date.now(),
          rowCount: 0,
          executionTimeMs: Math.round(performance.now() - startTime),
          error: message,
        };
        return [entry, ...prev].slice(0, 10);
      });
    } finally {
      setIsExecuting(false);
    }
  }, [sql, isExecuting, onQueryResult]);

  // -------------------------------------------------------------------------
  // Keyboard handlers
  // -------------------------------------------------------------------------

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Ctrl/Cmd + Enter to execute
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        executeQuery();
        return;
      }

      // Tab inserts 2 spaces
      if (e.key === "Tab") {
        e.preventDefault();
        const target = e.currentTarget;
        const start = target.selectionStart;
        const end = target.selectionEnd;
        const value = target.value;

        const newValue = value.substring(0, start) + "  " + value.substring(end);
        setSQL(newValue);

        // Restore cursor position after React re-render
        requestAnimationFrame(() => {
          target.selectionStart = target.selectionEnd = start + 2;
        });
      }
    },
    [executeQuery]
  );

  const handleChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setSQL(e.target.value);
  }, []);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const handleCopySQL = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(sql);
      setCopiedSQL(true);
      setTimeout(() => setCopiedSQL(false), 2000);
    } catch {
      // clipboard API may fail in some contexts
    }
  }, [sql]);

  const handleClear = useCallback(() => {
    setSQL("");
    setError(null);
    setLastResult(null);
    textareaRef.current?.focus();
  }, []);

  const handleFormat = useCallback(() => {
    setSQL(formatSQL(sql));
  }, [sql]);

  const handleHistorySelect = useCallback((entry: HistoryEntry) => {
    setSQL(entry.sql);
    setShowHistory(false);
    textareaRef.current?.focus();
  }, []);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const modKey = isMac() ? "\u2318" : "Ctrl";

  return (
    <div className="rounded-xl border border-gray-200/50 dark:border-gray-700/40 backdrop-blur-xl bg-white/60 dark:bg-gray-900/60 overflow-hidden shadow-sm">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-200/40 dark:border-gray-700/30 bg-gray-50/40 dark:bg-gray-800/40">
        <div className="flex items-center gap-1">
          {/* Execute */}
          <button
            onClick={executeQuery}
            disabled={isExecuting || !sql.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors shadow-sm"
            title={`Run query (${modKey}+Enter)`}
          >
            {isExecuting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            <span>Run</span>
          </button>

          {/* Format */}
          <button
            onClick={handleFormat}
            disabled={!sql.trim()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-200/60 dark:hover:bg-gray-700/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Format SQL"
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>Format</span>
          </button>

          {/* Copy */}
          <button
            onClick={handleCopySQL}
            disabled={!sql.trim()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-200/60 dark:hover:bg-gray-700/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Copy SQL"
          >
            {copiedSQL ? (
              <Check className="w-3.5 h-3.5 text-emerald-500" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            <span>{copiedSQL ? "Copied" : "Copy"}</span>
          </button>

          {/* Clear */}
          <button
            onClick={handleClear}
            disabled={!sql.trim()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-200/60 dark:hover:bg-gray-700/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Clear editor"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear</span>
          </button>
        </div>

        <div className="flex items-center gap-1">
          {/* History dropdown */}
          <div className="relative" ref={historyRef}>
            <button
              onClick={() => setShowHistory((v) => !v)}
              disabled={history.length === 0}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-200/60 dark:hover:bg-gray-700/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="Query history"
            >
              <History className="w-3.5 h-3.5" />
              <span>History</span>
              <ChevronDown
                className={`w-3 h-3 transition-transform ${showHistory ? "rotate-180" : ""}`}
              />
            </button>

            <AnimatePresence>
              {showHistory && history.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full mt-1 z-50 w-80 max-h-72 overflow-y-auto rounded-lg border border-gray-200/60 dark:border-gray-700/50 bg-white dark:bg-gray-900 shadow-lg"
                >
                  {history.map((entry, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleHistorySelect(entry)}
                      className="w-full text-left px-3 py-2.5 border-b border-gray-100 dark:border-gray-800 last:border-b-0 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
                    >
                      <p className="text-xs font-mono text-gray-700 dark:text-gray-300 truncate">
                        {entry.sql}
                      </p>
                      <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-400 dark:text-gray-500">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          {entry.executionTimeMs}ms
                        </span>
                        <span>
                          {entry.error
                            ? "Error"
                            : `${entry.rowCount} row${entry.rowCount !== 1 ? "s" : ""}`}
                        </span>
                        <span>
                          {new Date(entry.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Schema toggle */}
          <button
            onClick={() => setShowSchema((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              showSchema
                ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                : "text-gray-600 dark:text-gray-300 hover:bg-gray-200/60 dark:hover:bg-gray-700/50"
            }`}
            title="Toggle schema reference"
          >
            <Table2 className="w-3.5 h-3.5" />
            <span>Schema</span>
          </button>
        </div>
      </div>

      {/* Editor body */}
      <div className="flex">
        {/* Main editor area (line numbers + code) */}
        <div className="flex flex-1 min-w-0">
          {/* Line numbers */}
          <LineNumbers count={Math.max(MIN_LINES, lineCount)} />

          {/* Code editing area */}
          <div
            className="relative flex-1 min-w-0"
            style={{ height: editorHeight }}
          >
            {/* Highlighted pre (behind) */}
            <pre
              ref={preRef}
              className="absolute inset-0 overflow-auto px-3 py-2 text-xs leading-[20px] font-mono whitespace-pre-wrap break-words pointer-events-none m-0"
              aria-hidden
            >
              <HighlightedCode sql={sql} />
            </pre>

            {/* Transparent textarea (on top) */}
            <textarea
              ref={textareaRef}
              value={sql}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onScroll={handleScroll}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="absolute inset-0 w-full h-full resize-none overflow-auto px-3 py-2 text-xs leading-[20px] font-mono whitespace-pre-wrap break-words bg-transparent text-transparent caret-gray-800 dark:caret-gray-200 outline-none selection:bg-blue-200/40 dark:selection:bg-blue-700/30 m-0 border-0"
              placeholder="Write your SQL query here..."
            />
          </div>
        </div>

        {/* Schema panel */}
        <AnimatePresence>
          {showSchema && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 220, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden border-l border-gray-200/40 dark:border-gray-700/30 bg-gray-50/40 dark:bg-gray-800/30"
            >
              <div className="w-[220px] p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Table2 className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                  <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                    {tableName}
                  </h3>
                </div>
                <div className="space-y-0.5 max-h-60 overflow-y-auto">
                  {columns.map((col) => (
                    <button
                      key={col.name}
                      type="button"
                      onClick={() => {
                        // Insert column name at cursor
                        const ta = textareaRef.current;
                        if (!ta) return;
                        const start = ta.selectionStart;
                        const end = ta.selectionEnd;
                        const insert = `"${col.name}"`;
                        const updated =
                          sql.substring(0, start) + insert + sql.substring(end);
                        setSQL(updated);
                        requestAnimationFrame(() => {
                          ta.focus();
                          ta.selectionStart = ta.selectionEnd = start + insert.length;
                        });
                      }}
                      className="w-full flex items-center justify-between gap-2 px-2 py-1 rounded text-left hover:bg-gray-200/50 dark:hover:bg-gray-700/40 transition-colors group"
                      title={`Insert "${col.name}"`}
                    >
                      <span className="text-xs font-mono text-gray-700 dark:text-gray-300 truncate">
                        {col.name}
                      </span>
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0">
                        {col.type}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-gray-200/40 dark:border-gray-700/30 bg-gray-50/40 dark:bg-gray-800/40 text-[10px] text-gray-400 dark:text-gray-500">
        <div className="flex items-center gap-3">
          {isExecuting && (
            <span className="inline-flex items-center gap-1 text-amber-500 dark:text-amber-400">
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
              Executing...
            </span>
          )}
          {!isExecuting && lastResult && (
            <>
              <span className="inline-flex items-center gap-1 text-emerald-500 dark:text-emerald-400">
                <Check className="w-2.5 h-2.5" />
                {lastResult.data.length} row{lastResult.data.length !== 1 ? "s" : ""}
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock className="w-2.5 h-2.5" />
                {lastResult.executionTimeMs}ms
              </span>
            </>
          )}
          {!isExecuting && error && (
            <span className="inline-flex items-center gap-1 text-red-500 dark:text-red-400">
              <AlertCircle className="w-2.5 h-2.5" />
              Error
            </span>
          )}
        </div>

        <span className="tabular-nums">
          Ln {lineCount}, Col{" "}
          {typeof document !== "undefined" &&
          textareaRef.current
            ? textareaRef.current.selectionStart -
              sql.lastIndexOf("\n", textareaRef.current.selectionStart - 1)
            : 1}
        </span>
      </div>

      {/* Error display */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 py-2.5 border-t border-red-200/40 dark:border-red-800/30 bg-red-50/60 dark:bg-red-900/10">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-3.5 h-3.5 text-red-500 dark:text-red-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-red-600 dark:text-red-400 font-mono break-all leading-relaxed">
                  {error}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
