"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Bot, Copy, History, Loader2, Play, Sparkles } from "lucide-react";
import { generateSQL } from "@/lib/ai/sql-generator";
import { runQuery } from "@/lib/duckdb/client";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
} from "@/lib/utils/advanced-analytics";
import { formatNumber, formatRelativeTime, generateId } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface AIQueryGeneratorProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface QueryHistoryItem {
  id: string;
  prompt: string;
  sql: string;
  createdAt: number;
  rowCount: number | null;
}

const STORAGE_KEY = "datalens-ai-query-generator-history";

function isHistoryItem(value: unknown): value is QueryHistoryItem {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as QueryHistoryItem).id === "string" &&
    typeof (value as QueryHistoryItem).prompt === "string" &&
    typeof (value as QueryHistoryItem).sql === "string" &&
    typeof (value as QueryHistoryItem).createdAt === "number"
  );
}

function readHistory() {
  if (typeof window === "undefined") return [] as QueryHistoryItem[];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isHistoryItem) : [];
  } catch {
    return [];
  }
}

export default function AIQueryGenerator({
  tableName,
  columns,
}: AIQueryGeneratorProps) {
  const [prompt, setPrompt] = useState("");
  const [generatedSql, setGeneratedSql] = useState("");
  const [history, setHistory] = useState<QueryHistoryItem[]>(() => readHistory());
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const deferredPrompt = useDeferredValue(prompt);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  }, [history]);

  const filteredHistory = useMemo(() => {
    const search = deferredPrompt.trim().toLowerCase();
    if (!search) return history;

    return history.filter((item) => {
      const haystack = `${item.prompt}\n${item.sql}`.toLowerCase();
      return haystack.includes(search);
    });
  }, [deferredPrompt, history]);

  async function handleGenerate() {
    const question = prompt.trim();
    if (!question) {
      setStatus("Enter a natural-language request before generating SQL.");
      return;
    }

    setLoading(true);
    setStatus(null);

    try {
      const sql = await generateSQL(question, tableName, columns);
      const nextItem: QueryHistoryItem = {
        id: generateId(),
        prompt: question,
        sql,
        createdAt: Date.now(),
        rowCount: null,
      };

      setGeneratedSql(sql);
      setHistory((current) => [nextItem, ...current].slice(0, 12));
      setStatus("Generated SQL with Ollama.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "SQL generation failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!generatedSql) return;

    await navigator.clipboard.writeText(generatedSql);
    setStatus("Copied SQL to clipboard.");
  }

  async function handleExecute() {
    if (!generatedSql) return;

    setExecuting(true);
    setStatus(null);

    try {
      const rows = await runQuery(generatedSql);
      setHistory((current) =>
        current.map((item) =>
          item.sql === generatedSql ? { ...item, rowCount: rows.length } : item,
        ),
      );
      setStatus(`Executed SQL and returned ${formatNumber(rows.length)} rows.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "SQL execution failed.");
    } finally {
      setExecuting(false);
    }
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Bot className="h-6 w-6 text-cyan-600 dark:text-cyan-300" />
            <h2 className="text-xl font-semibold text-slate-950 dark:text-slate-50">
              Generate DuckDB SQL from natural language
            </h2>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
            Use Ollama to turn business questions into executable SQL, keep a local history of
            generated queries, and run the result against {tableName}.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={loading}
            className={BUTTON_CLASS}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Generate SQL
          </button>
          <button
            type="button"
            onClick={() => void handleCopy()}
            disabled={!generatedSql}
            className={BUTTON_CLASS}
          >
            <Copy className="h-4 w-4" />
            Copy SQL
          </button>
          <button
            type="button"
            onClick={() => void handleExecute()}
            disabled={!generatedSql || executing}
            className={BUTTON_CLASS}
          >
            {executing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Execute SQL
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: ANALYTICS_EASE }}
          className={`${GLASS_CARD_CLASS} p-4`}
        >
          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Ask a question
            </span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder='For example: "Show monthly revenue by region for the last 12 months."'
              className={`${FIELD_CLASS} min-h-32 resize-none`}
            />
          </label>

          <div className="mt-4 rounded-3xl border border-white/20 bg-slate-950 px-4 py-4 text-sm text-slate-100">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              <Sparkles className="h-4 w-4" />
              Generated SQL
            </div>
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap font-mono text-sm leading-6">
              {generatedSql || "-- Generated DuckDB SQL appears here."}
            </pre>
          </div>

          {status ? (
            <p className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-700 dark:text-cyan-300">
              {status}
            </p>
          ) : null}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
          className={`${GLASS_CARD_CLASS} p-4`}
        >
          <div className="flex items-center gap-2 text-base font-semibold text-slate-950 dark:text-slate-50">
            <History className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
            Generated query history
          </div>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Recent prompts are stored locally in the browser for quick reuse.
          </p>

          <div className="mt-4 space-y-3">
            {filteredHistory.length > 0 ? (
              filteredHistory.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setPrompt(item.prompt);
                    setGeneratedSql(item.sql);
                    setStatus("Loaded a query from history.");
                  }}
                  className="block w-full rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-left transition hover:border-cyan-400/30 hover:bg-white dark:bg-slate-950/55 dark:hover:bg-slate-900/80"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {item.prompt}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {formatRelativeTime(item.createdAt)}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-3 font-mono text-xs text-slate-500 dark:text-slate-400">
                    {item.sql}
                  </p>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    {item.rowCount === null
                      ? "Not executed yet"
                      : `${formatNumber(item.rowCount)} rows on last execution`}
                  </p>
                </button>
              ))
            ) : (
              <p className="rounded-2xl border border-white/20 bg-white/70 px-4 py-4 text-sm text-slate-600 dark:bg-slate-950/55 dark:text-slate-300">
                No generated queries yet.
              </p>
            )}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
