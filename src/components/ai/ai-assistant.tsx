"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bot,
  ChartColumn,
  Database,
  MessageSquare,
  Send,
  Sparkles,
  Trash2,
  User,
  X,
} from "lucide-react";
import { assessDataQuality } from "@/lib/utils/data-quality";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface AiAssistantProps {
  tableName?: string;
  columns?: ColumnProfile[];
  rowCount?: number;
}

type Role = "user" | "assistant";

interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  timestamp: number;
}

const EASE = [0.16, 1, 0.3, 1] as const;
const STORAGE_KEY = "datalens-ai-assistant-chat";
const QUICK_PROMPTS = [
  "How many rows?",
  "What columns are there?",
  "Show nulls",
  "Describe revenue",
  "Data quality",
  "Suggest chart",
] as const;

function createId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildMessage(role: Role, content: string, offset = 0): ChatMessage {
  return {
    id: createId(),
    role,
    content,
    timestamp: Date.now() + offset,
  };
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function introMessage(tableName?: string): ChatMessage {
  return buildMessage(
    "assistant",
    tableName
      ? `I’m watching ${tableName}. Ask about rows, columns, nulls, data quality, chart suggestions, or describe a specific column.`
      : "Load a dataset, then ask about rows, columns, nulls, data quality, chart suggestions, or a specific column.",
  );
}

function loadStoredHistory(tableName?: string): ChatMessage[] {
  if (typeof window === "undefined") return [introMessage(tableName)];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [introMessage(tableName)];
    const parsed = JSON.parse(raw) as ChatMessage[];
    return Array.isArray(parsed) && parsed.length ? parsed : [introMessage(tableName)];
  } catch {
    return [introMessage(tableName)];
  }
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function columnByName(columns: ColumnProfile[], name: string): ColumnProfile | null {
  const normalized = normalize(name);
  return (
    columns.find((column) => normalize(column.name) === normalized) ??
    columns.find((column) => normalize(column.name).includes(normalized)) ??
    null
  );
}

function describeColumn(column: ColumnProfile): string {
  const stats: string[] = [
    `${column.name} is typed as ${column.type}.`,
    `${formatNumber(column.nullCount)} nulls and ${formatNumber(column.uniqueCount)} unique values are currently profiled.`,
  ];

  if (column.type === "number") {
    const numeric: string[] = [];
    if (typeof column.mean === "number") numeric.push(`mean ${formatNumber(column.mean)}`);
    if (typeof column.median === "number") numeric.push(`median ${formatNumber(column.median)}`);
    if (typeof column.min === "number") numeric.push(`min ${formatNumber(column.min)}`);
    if (typeof column.max === "number") numeric.push(`max ${formatNumber(column.max)}`);
    if (numeric.length) stats.push(`Numeric summary: ${numeric.join(", ")}.`);
  } else if (column.type === "date") {
    if (column.min || column.max) {
      stats.push(`Observed range: ${String(column.min ?? "n/a")} to ${String(column.max ?? "n/a")}.`);
    }
  }

  if (column.sampleValues.length) {
    stats.push(`Sample values: ${column.sampleValues.map((value) => (value == null ? "null" : String(value))).join(", ")}.`);
  }

  return stats.join(" ");
}

function columnsSummary(columns: ColumnProfile[]): string {
  if (!columns.length) return "No columns are available yet.";
  return columns.map((column) => `${column.name} (${column.type})`).join(", ");
}

function nullSummary(columns: ColumnProfile[], rowCount: number): string {
  if (!columns.length) return "No columns are loaded yet.";
  const ranked = [...columns].sort((left, right) => right.nullCount - left.nullCount);
  const lines = ranked
    .slice(0, 8)
    .map((column) => {
      const rate = rowCount ? (column.nullCount / rowCount) * 100 : 0;
      return `${column.name}: ${formatNumber(column.nullCount)} nulls (${formatPercent(rate, 1)})`;
    });
  return lines.length ? lines.join("\n") : "No null analysis is available.";
}

function qualitySummary(columns: ColumnProfile[], rowCount: number): string {
  const quality = assessDataQuality(columns, rowCount);
  const completeness = rowCount
    ? 100 - (columns.reduce((sum, column) => sum + column.nullCount, 0) / (rowCount * Math.max(columns.length, 1))) * 100
    : 0;
  return [
    `${quality.summary}`,
    `Completeness is ${formatPercent(Math.max(0, completeness), 1)} across ${formatNumber(columns.length)} columns.`,
    quality.issues.length
      ? `Top issue: ${quality.issues[0]?.column} — ${quality.issues[0]?.message}`
      : "No quality issues are currently flagged.",
  ].join(" ");
}

function chartSuggestion(columns: ColumnProfile[]): string {
  const numeric = columns.filter((column) => column.type === "number");
  const categorical = columns.filter((column) => column.type === "string" || column.type === "boolean");
  const dates = columns.filter((column) => column.type === "date");

  if (dates.length && numeric.length) {
    return `Try a line chart using ${dates[0].name} on the x-axis and ${numeric[0].name} on the y-axis.`;
  }
  if (categorical.length && numeric.length) {
    return `A bar chart would work well: ${categorical[0].name} by ${numeric[0].name}.`;
  }
  if (numeric.length >= 2) {
    return `A scatter plot is a good fit for ${numeric[0].name} versus ${numeric[1].name}.`;
  }
  if (categorical.length) {
    return `A pie chart could summarize the distribution of ${categorical[0].name}.`;
  }
  return "Try asking again after profiling a dataset with categorical, numeric, or date columns.";
}

function helpText(): string {
  return [
    "Available commands:",
    "• How many rows?",
    "• What columns are there?",
    "• Show nulls / null analysis",
    "• Describe [column]",
    "• Data quality",
    "• Suggest chart",
    "• Help",
  ].join("\n");
}

function generateResponse(
  query: string,
  tableName: string | undefined,
  columns: ColumnProfile[],
  rowCount: number,
): string {
  const normalized = normalize(query);
  if (!tableName || !columns.length) {
    return "Load a dataset first, then ask about rows, columns, nulls, data quality, or chart suggestions.";
  }

  if (normalized.includes("help")) {
    return helpText();
  }

  if (normalized.includes("how many rows") || normalized === "rows" || normalized.includes("row count")) {
    return `${tableName} currently has ${formatNumber(rowCount)} rows.`;
  }

  if (normalized.includes("what columns") || normalized.includes("columns are there") || normalized === "columns") {
    return `Columns in ${tableName}: ${columnsSummary(columns)}.`;
  }

  if (normalized.includes("show nulls") || normalized.includes("null analysis") || normalized === "nulls") {
    return `Null analysis for ${tableName}:\n${nullSummary(columns, rowCount)}`;
  }

  if (normalized.startsWith("describe ")) {
    const rawName = query.trim().slice(9);
    const column = columnByName(columns, rawName);
    return column
      ? describeColumn(column)
      : `I couldn't find a column matching "${rawName}". Try asking with the exact column name.`;
  }

  if (normalized.includes("data quality") || normalized.includes("quality summary")) {
    return qualitySummary(columns, rowCount);
  }

  if (normalized.includes("suggest chart") || normalized.includes("chart suggestion") || normalized.includes("recommend chart")) {
    return chartSuggestion(columns);
  }

  return "Try asking about columns, nulls, data quality, or chart suggestions.";
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const assistant = message.role === "assistant";
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: EASE }}
      className={`flex gap-3 ${assistant ? "justify-start" : "justify-end"}`}
    >
      {assistant ? (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
          <Bot className="h-4 w-4" />
        </div>
      ) : null}
      <div className={`max-w-[82%] rounded-3xl border px-4 py-3 ${assistant ? "border-white/10 bg-white/10 text-slate-700 dark:bg-slate-900/70 dark:text-slate-200" : "border-cyan-400/20 bg-cyan-600 text-white"}`}>
        <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>
        <p className={`mt-2 text-[11px] ${assistant ? "text-slate-500 dark:text-slate-400" : "text-cyan-100"}`}>
          {formatTimestamp(message.timestamp)}
        </p>
      </div>
      {!assistant ? (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-slate-700 dark:text-slate-200">
          <User className="h-4 w-4" />
        </div>
      ) : null}
    </motion.div>
  );
}

export default function AiAssistant({
  tableName,
  columns = [],
  rowCount = 0,
}: AiAssistantProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadStoredHistory(tableName));
  const datasetSummary = useMemo(() => {
    if (!tableName || !columns.length) return "No active dataset";
    return `${tableName} • ${formatNumber(rowCount)} rows • ${formatNumber(columns.length)} columns`;
  }, [columns.length, rowCount, tableName]);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // Ignore storage failures; the assistant still works without persistence.
    }
  }, [messages]);

  function sendMessage(content: string) {
    const text = content.trim();
    if (!text) return;

    const userMessage = buildMessage("user", text);
    const assistantMessage = buildMessage(
      "assistant",
      generateResponse(text, tableName, columns, rowCount),
      1,
    );

    setMessages((current) => [...current, userMessage, assistantMessage]);
    setDraft("");
  }

  function clearChat() {
    const reset = [introMessage(tableName)];
    setMessages(reset);
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(reset));
    } catch {
      // Ignore storage failures; the UI already reset.
    }
  }

  return (
    <>
      <AnimatePresence>
        {open ? (
          <motion.aside
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.96 }}
            transition={{ duration: 0.22, ease: EASE }}
            className="fixed bottom-24 right-4 z-50 flex h-[min(42rem,calc(100vh-8rem))] w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-[28px] border border-white/10 bg-white/10 shadow-2xl shadow-slate-950/20 backdrop-blur-2xl dark:bg-slate-950/60"
          >
            <div className="border-b border-white/10 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
                    <Sparkles className="h-3.5 w-3.5" />
                    AI Assistant
                  </div>
                  <h2 className="mt-3 text-lg font-semibold text-slate-950 dark:text-slate-50">Contextual data help</h2>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{datasetSummary}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-2xl border border-white/10 bg-white/10 p-2 text-slate-600 transition hover:bg-white/15 dark:text-slate-300"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => sendMessage(prompt)}
                    className="rounded-full border border-white/10 bg-black/10 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-cyan-400/20 hover:bg-cyan-500/10 hover:text-cyan-700 dark:text-slate-300 dark:hover:text-cyan-300"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
              {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
            </div>

            <div className="border-t border-white/10 px-5 py-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="inline-flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <Database className="h-3.5 w-3.5" />
                  Rule-based responses only
                </div>
                <button
                  type="button"
                  onClick={clearChat}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-white/15 dark:text-slate-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear Chat
                </button>
              </div>

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  sendMessage(draft);
                }}
                className="flex items-end gap-3"
              >
                <label className="flex-1">
                  <span className="sr-only">Ask about your data</span>
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    rows={2}
                    placeholder="Ask about rows, columns, nulls, quality, or chart suggestions..."
                    className="w-full resize-none rounded-3xl border border-white/10 bg-black/10 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-400 dark:text-slate-100"
                  />
                </label>
                <button
                  type="submit"
                  disabled={!draft.trim()}
                  className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-600 text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>
            </div>
          </motion.aside>
        ) : null}
      </AnimatePresence>

      <motion.button
        type="button"
        onClick={() => setOpen((current) => !current)}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.98 }}
        transition={{ duration: 0.18, ease: EASE }}
        className="fixed bottom-4 right-4 z-50 inline-flex h-16 w-16 items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-600 text-white shadow-2xl shadow-cyan-900/30 backdrop-blur-xl"
        aria-label="Toggle AI assistant"
      >
        <div className="relative">
          <MessageSquare className="h-6 w-6" />
          <ChartColumn className="absolute -right-2 -top-2 h-4 w-4 rounded-full bg-cyan-400 p-0.5 text-cyan-950" />
        </div>
      </motion.button>
    </>
  );
}
