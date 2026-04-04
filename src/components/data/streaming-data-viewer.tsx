"use client";

import { motion } from "framer-motion";
import {
  type FormEvent,
  useMemo,
  useState,
} from "react";
import { useStreamingQuery } from "@/hooks/use-streaming-query";

export interface StreamingDataViewerProps {
  wsUrl?: string;
  className?: string;
}

const DEFAULT_WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws/data-stream";
const PANEL_CLASS =
  "rounded-2xl border border-white/20 bg-white/60 backdrop-blur-xl dark:bg-slate-900/60";
const EASE = [0.22, 1, 0.36, 1] as const;

function mergeClasses(...classNames: Array<string | false | null | undefined>) {
  return classNames.filter(Boolean).join(" ");
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function formatCellValue(value: unknown) {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export default function StreamingDataViewer({
  wsUrl = DEFAULT_WS_URL,
  className,
}: StreamingDataViewerProps) {
  const [query, setQuery] = useState("");
  const { rows, isStreaming, progress, error, isConnected, execute } = useStreamingQuery(wsUrl);

  const columns = useMemo(() => {
    if (rows.length === 0) {
      return [];
    }

    return Object.keys(rows[0]);
  }, [rows]);

  const progressPercent = clampPercent(Math.round(progress?.percent ?? 0));
  const streamedRowLabel = `${rows.length.toLocaleString()} row${rows.length === 1 ? "" : "s"} streamed`;
  const progressLabel = progress?.label ?? progress?.stage ?? "Streaming dataset";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    execute(query);
  }

  return (
    <motion.section
      className={mergeClasses(
        PANEL_CLASS,
        "overflow-hidden p-5 shadow-[0_24px_90px_-46px_rgba(15,23,42,0.76)]",
        className,
      )}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: EASE }}
    >
      <div className="flex flex-col gap-5">
        <motion.div
          className="flex flex-col gap-4 border-b border-white/15 pb-5 md:flex-row md:items-start md:justify-between"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: EASE, delay: 0.04 }}
        >
          <div>
            <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">
              Streaming Data Viewer
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Run a SQL query and inspect rows as the server streams them in real time.
            </p>
          </div>

          <div
            className="inline-flex items-center gap-3 rounded-full border border-white/15 bg-white/55 px-3 py-2 text-sm text-slate-700 dark:bg-slate-950/35 dark:text-slate-200"
            role="status"
            aria-live="polite"
          >
            <span
              aria-label={`WebSocket ${isConnected ? "connected" : "disconnected"}`}
              className={mergeClasses(
                "h-2.5 w-2.5 rounded-full",
                isConnected ? "bg-emerald-500" : "bg-rose-500",
              )}
            />
            <span>{isConnected ? "Connected" : "Disconnected"}</span>
          </div>
        </motion.div>

        <motion.form
          className="flex flex-col gap-3 md:flex-row"
          onSubmit={handleSubmit}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: EASE, delay: 0.08 }}
        >
          <input
            aria-label="SQL query"
            className="min-h-12 flex-1 rounded-xl border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:bg-slate-950/45 dark:text-slate-50 dark:placeholder:text-slate-500"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="SELECT * FROM dataset LIMIT 100"
            spellCheck={false}
            value={query}
          />
          <button
            className="inline-flex min-h-12 items-center justify-center rounded-xl bg-slate-950 px-5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-cyan-500 dark:text-slate-950 dark:hover:bg-cyan-400"
            disabled={isStreaming || query.trim().length === 0}
            type="submit"
          >
            {isStreaming ? "Streaming..." : "Stream"}
          </button>
        </motion.form>

        {error ? (
          <motion.div
            className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: EASE }}
            role="alert"
          >
            {error}
          </motion.div>
        ) : null}

        {isStreaming ? (
          <motion.div
            className="rounded-2xl border border-cyan-500/15 bg-cyan-500/5 p-4"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: EASE, delay: 0.12 }}
          >
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {progressLabel}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{streamedRowLabel}</p>
              </div>
              <span className="text-sm font-semibold text-cyan-700 dark:text-cyan-300">
                {progressPercent}%
              </span>
            </div>

            <div
              aria-label="Streaming progress"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={progressPercent}
              className="h-2 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800/80"
              role="progressbar"
            >
              <motion.div
                animate={{ width: `${progressPercent}%` }}
                className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-sky-500 to-emerald-400"
                initial={{ width: 0 }}
                transition={{ duration: 0.3, ease: EASE }}
              />
            </div>
          </motion.div>
        ) : null}

        {rows.length > 0 ? (
          <motion.div
            className="overflow-hidden rounded-2xl border border-white/15"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: EASE, delay: 0.16 }}
          >
            <div className="max-h-[26rem] overflow-y-auto">
              <table className="min-w-full divide-y divide-white/10 text-left text-sm">
                <thead className="sticky top-0 bg-white/85 backdrop-blur dark:bg-slate-950/80">
                  <tr>
                    {columns.map((column) => (
                      <th
                        className="px-4 py-3 font-medium uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                        key={column}
                        scope="col"
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {rows.map((row, index) => (
                    <tr
                      className="bg-white/30 text-slate-700 transition hover:bg-white/45 dark:bg-slate-950/20 dark:text-slate-200 dark:hover:bg-slate-950/35"
                      key={`row-${index}`}
                    >
                      {columns.map((column) => (
                        <td
                          className="max-w-[18rem] px-4 py-3 align-top text-sm"
                          key={`${index}-${column}`}
                        >
                          <span className="block truncate" title={formatCellValue(row[column])}>
                            {formatCellValue(row[column])}
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        ) : null}

        {!isStreaming && !error && rows.length === 0 ? (
          <motion.div
            className="flex min-h-40 items-center justify-center rounded-2xl border border-dashed border-white/20 bg-white/25 px-4 text-center text-sm text-slate-500 dark:bg-slate-950/20 dark:text-slate-400"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: EASE, delay: 0.12 }}
          >
            <div>
              <p className="font-medium text-slate-700 dark:text-slate-200">No results yet</p>
              <p className="mt-1">Submit a SQL query to start streaming dataset rows.</p>
            </div>
          </motion.div>
        ) : null}
      </div>
    </motion.section>
  );
}
