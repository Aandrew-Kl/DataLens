"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Send, User, Bot, Loader2, ChevronRight } from "lucide-react";
import type { ColumnProfile } from "@/types/dataset";
import type { ChartConfig } from "@/types/chart";
import { runQuery } from "@/lib/duckdb/client";
import { useQueryStore } from "@/stores/query-store";
import { generateId } from "@/lib/utils/formatters";
import DataTable from "@/components/data/data-table";
import ChartRenderer from "@/components/charts/chart-renderer";

interface ChatInterfaceProps {
  datasetId: string;
  tableName: string;
  columns: ColumnProfile[];
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sql?: string;
  data?: Record<string, unknown>[];
  resultColumns?: string[];
  chart?: ChartConfig;
  summary?: string;
  error?: string;
  timestamp: number;
}

function LoadingDots() {
  return (
    <span className="inline-flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-purple-400 dark:bg-purple-500"
          animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1, 0.8] }}
          transition={{ repeat: Infinity, duration: 1, delay: i * 0.2 }}
        />
      ))}
    </span>
  );
}

function SqlBlock({ sql }: { sql: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg overflow-hidden border border-gray-200/60 dark:border-gray-700/50 my-2">
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-100 dark:bg-gray-800 border-b border-gray-200/60 dark:border-gray-700/50">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          SQL
        </span>
        <button
          onClick={handleCopy}
          className="text-[10px] font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="px-3 py-2.5 text-xs leading-relaxed overflow-x-auto bg-gray-50 dark:bg-gray-900/80 text-gray-700 dark:text-gray-300 font-mono">
        {sql}
      </pre>
    </div>
  );
}

export default function ChatInterface({
  datasetId,
  tableName,
  columns,
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { addToHistory, setLastResult, setIsQuerying } = useQueryStore();

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Fetch suggested questions
  useEffect(() => {
    let cancelled = false;

    async function fetchSuggestions() {
      setLoadingSuggestions(true);
      try {
        const res = await fetch("/api/ai/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "questions",
            tableName,
            columns,
            rowCount: 0,
          }),
        });
        if (!cancelled && res.ok) {
          const data = await res.json();
          setSuggestions(Array.isArray(data.questions) ? data.questions.slice(0, 5) : []);
        }
      } catch {
        // Suggestions are non-critical; silently fail
      } finally {
        if (!cancelled) setLoadingSuggestions(false);
      }
    }

    fetchSuggestions();
    return () => {
      cancelled = true;
    };
  }, [tableName, columns]);

  const handleSubmit = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || isLoading) return;

      setInput("");
      setIsLoading(true);
      setIsQuerying(true);

      const userMsg: ChatMessage = {
        id: generateId(),
        role: "user",
        content: trimmed,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);

      const assistantId = generateId();

      try {
        // Step 1: Generate SQL
        const sqlRes = await fetch("/api/ai/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: trimmed, tableName, columns }),
        });

        if (!sqlRes.ok) {
          throw new Error("Failed to generate SQL. Is Ollama running?");
        }

        const { sql } = await sqlRes.json();

        // Step 2: Execute SQL via DuckDB
        const startTime = performance.now();
        const data = await runQuery(sql);
        const executionTimeMs = performance.now() - startTime;

        const resultColumns = data.length > 0 ? Object.keys(data[0]) : [];

        // Step 3: Get chart recommendation and summary in parallel
        const [chartRes, summaryRes] = await Promise.allSettled([
          fetch("/api/ai/query", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              question: `Given this SQL: ${sql}\nWith columns: ${resultColumns.join(", ")}\nAnd ${data.length} rows of results, recommend a chart config as JSON with type, title, xAxis, yAxis fields. Sample data: ${JSON.stringify(data.slice(0, 3))}`,
              tableName,
              columns,
            }),
          }),
          fetch("/api/ai/query", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              question: `Summarize the answer to "${trimmed}" given this data with ${data.length} rows: ${JSON.stringify(data.slice(0, 10))}. Be concise (2-3 sentences).`,
              tableName,
              columns,
            }),
          }),
        ]);

        let chart: ChartConfig | undefined;
        if (chartRes.status === "fulfilled" && chartRes.value.ok) {
          try {
            const chartBody = await chartRes.value.json();
            // Try to parse chart config from the SQL response
            let jsonStr = chartBody.sql || "";
            if (jsonStr.startsWith("```")) {
              jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
            }
            const parsed = JSON.parse(jsonStr);
            chart = {
              id: generateId(),
              type: parsed.type || "bar",
              title: parsed.title || "",
              xAxis: parsed.xAxis,
              yAxis: parsed.yAxis,
            };
          } catch {
            // Chart recommendation failed; skip
          }
        }

        let summary = "";
        if (summaryRes.status === "fulfilled" && summaryRes.value.ok) {
          try {
            const summaryBody = await summaryRes.value.json();
            summary = summaryBody.sql || "";
          } catch {
            // Summary failed; skip
          }
        }

        const assistantMsg: ChatMessage = {
          id: assistantId,
          role: "assistant",
          content: "",
          sql,
          data,
          resultColumns,
          chart,
          summary,
          timestamp: Date.now(),
        };

        setMessages((prev) => [...prev, assistantMsg]);

        // Store in query history
        const queryResult = {
          sql,
          data,
          columns: resultColumns,
          rowCount: data.length,
          chart,
          summary,
          executionTimeMs,
        };
        setLastResult(queryResult);
        addToHistory({
          id: generateId(),
          question: trimmed,
          sql,
          datasetId,
          createdAt: Date.now(),
        });
      } catch (err) {
        const errorMsg: ChatMessage = {
          id: assistantId,
          role: "assistant",
          content: "",
          error: err instanceof Error ? err.message : "Something went wrong",
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsLoading(false);
        setIsQuerying(false);
        inputRef.current?.focus();
      }
    },
    [isLoading, tableName, columns, datasetId, addToHistory, setLastResult, setIsQuerying]
  );

  return (
    <div className="flex flex-col h-full min-h-[500px] max-h-[800px] rounded-2xl overflow-hidden border border-gray-200/50 dark:border-gray-700/50 backdrop-blur-xl bg-white/60 dark:bg-gray-900/60">
      {/* Suggestions */}
      {suggestions.length > 0 && messages.length === 0 && (
        <div className="px-4 pt-4 pb-2">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-400 dark:text-gray-500 mb-2">
            Suggested questions
          </p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((q, i) => (
              <motion.button
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                onClick={() => handleSubmit(q)}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-full border border-purple-200/60 dark:border-purple-800/40 bg-purple-50/60 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors"
              >
                <ChevronRight className="w-3 h-3" />
                <span className="truncate max-w-[260px]">{q}</span>
              </motion.button>
            ))}
          </div>
        </div>
      )}

      {loadingSuggestions && messages.length === 0 && (
        <div className="px-4 pt-4 flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
          <Loader2 className="w-3 h-3 animate-spin" />
          Loading suggestions...
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && !loadingSuggestions && suggestions.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-300 dark:text-gray-600">
            <Sparkles className="w-10 h-10" />
            <p className="text-sm">Ask anything about your data</p>
          </div>
        )}

        <AnimatePresence>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && (
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center mt-0.5">
                  <Bot className="w-4 h-4 text-white" />
                </div>
              )}

              <div
                className={`max-w-[85%] ${
                  msg.role === "user"
                    ? "bg-purple-500 text-white rounded-2xl rounded-br-md px-4 py-2.5"
                    : "flex-1 min-w-0"
                }`}
              >
                {msg.role === "user" ? (
                  <p className="text-sm">{msg.content}</p>
                ) : (
                  <div className="space-y-3">
                    {msg.error ? (
                      <div className="rounded-xl border border-red-200/60 dark:border-red-800/40 bg-red-50/60 dark:bg-red-900/20 px-4 py-3">
                        <p className="text-sm text-red-600 dark:text-red-400">
                          {msg.error}
                        </p>
                      </div>
                    ) : (
                      <>
                        {msg.sql && <SqlBlock sql={msg.sql} />}

                        {msg.summary && (
                          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                            {msg.summary}
                          </p>
                        )}

                        {msg.chart && msg.data && msg.data.length > 0 && (
                          <div className="rounded-xl border border-gray-200/60 dark:border-gray-700/50 overflow-hidden bg-white dark:bg-gray-900/80 p-2">
                            <ChartRenderer config={msg.chart} data={msg.data} />
                          </div>
                        )}

                        {msg.data && msg.resultColumns && msg.data.length > 0 && (
                          <DataTable
                            data={msg.data.slice(0, 50)}
                            columns={msg.resultColumns}
                          />
                        )}

                        {msg.data && msg.data.length === 0 && (
                          <p className="text-sm text-gray-400 dark:text-gray-500 italic">
                            Query returned no results.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              {msg.role === "user" && (
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center mt-0.5">
                  <User className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex gap-3"
          >
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div className="bg-gray-100 dark:bg-gray-800 rounded-2xl rounded-bl-md px-4 py-3">
              <LoadingDots />
            </div>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-gray-200/60 dark:border-gray-700/50 px-4 py-3 bg-white/40 dark:bg-gray-900/40">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit(input);
          }}
          className="flex items-center gap-2"
        >
          <div className="relative flex-1">
            <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 dark:text-gray-600" />
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything about your data..."
              disabled={isLoading}
              className="
                w-full pl-10 pr-4 py-2.5 text-sm
                rounded-xl border border-gray-200/60 dark:border-gray-700/50
                bg-white/80 dark:bg-gray-800/80
                text-gray-700 dark:text-gray-200
                placeholder-gray-400 dark:placeholder-gray-500
                focus:outline-none focus:ring-2 focus:ring-purple-400/40 dark:focus:ring-purple-500/30
                focus:border-purple-300 dark:focus:border-purple-600
                disabled:opacity-50
                transition-all
              "
            />
          </div>
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="
              flex items-center justify-center w-10 h-10
              rounded-xl
              bg-purple-500 hover:bg-purple-600
              disabled:opacity-40 disabled:cursor-not-allowed
              text-white
              transition-colors
              shadow-sm hover:shadow-md
            "
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
