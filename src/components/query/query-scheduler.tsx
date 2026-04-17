"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Clock3,
  History,
  Loader2,
  Play,
  Plus,
  ToggleLeft,
  ToggleRight,
  Trash2,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatRelativeTime, generateId } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface QuerySchedulerProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface SavedQueryRecord {
  id: string;
  name: string;
  sql: string;
}

type ScheduleMode = "interval" | "cron";

interface QuerySchedule {
  id: string;
  name: string;
  queryId: string;
  sql: string;
  outputTable: string;
  mode: ScheduleMode;
  intervalMinutes: number;
  cronExpression: string;
  enabled: boolean;
  createdAt: number;
  lastRunAt: number | null;
}

interface ScheduleHistoryEntry {
  id: string;
  scheduleId: string;
  scheduleName: string;
  ranAt: number;
  status: "success" | "error";
  rowCount: number;
  outputTable: string;
  message: string;
}

interface StatusMessage {
  tone: "success" | "error" | "info";
  text: string;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const GLASS_PANEL_CLASS =
  "border border-white/20 bg-white/75 backdrop-blur-2xl dark:bg-slate-950/45";
const FIELD_CLASS =
  "w-full rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:border-slate-700/70 dark:bg-slate-950/65 dark:text-slate-100";
const BUTTON_CLASS =
  "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60";
const SAVED_QUERY_STORAGE_KEY = "datalens-saved-queries";
const SCHEDULE_STORAGE_KEY = "datalens-query-schedules";
const HISTORY_STORAGE_KEY = "datalens-query-schedule-history";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readSavedQueries() {
  if (typeof window === "undefined") return [] as SavedQueryRecord[];

  try {
    const raw = window.localStorage.getItem(SAVED_QUERY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap<SavedQueryRecord>((item) => {
      if (!isRecord(item)) return [];
      const id = typeof item.id === "string" ? item.id : generateId();
      const name = typeof item.name === "string" ? item.name : "Saved query";
      const sql = typeof item.sql === "string" ? item.sql : "";
      return sql.trim() ? [{ id, name, sql }] : [];
    });
  } catch {
    return [];
  }
}

function readSchedules() {
  if (typeof window === "undefined") return [] as QuerySchedule[];

  try {
    const raw = window.localStorage.getItem(SCHEDULE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap<QuerySchedule>((item) => {
      if (!isRecord(item)) return [];
      return [
        {
          id: typeof item.id === "string" ? item.id : generateId(),
          name: typeof item.name === "string" ? item.name : "Query schedule",
          queryId: typeof item.queryId === "string" ? item.queryId : "",
          sql: typeof item.sql === "string" ? item.sql : "",
          outputTable:
            typeof item.outputTable === "string" ? item.outputTable : "scheduled_output",
          mode: item.mode === "cron" ? "cron" : "interval",
          intervalMinutes:
            typeof item.intervalMinutes === "number" && item.intervalMinutes > 0
              ? item.intervalMinutes
              : 15,
          cronExpression:
            typeof item.cronExpression === "string" ? item.cronExpression : "0 * * * *",
          enabled: Boolean(item.enabled),
          createdAt:
            typeof item.createdAt === "number" ? item.createdAt : Date.now(),
          lastRunAt:
            typeof item.lastRunAt === "number" ? item.lastRunAt : null,
        },
      ];
    });
  } catch {
    return [];
  }
}

function readHistory() {
  if (typeof window === "undefined") return [] as ScheduleHistoryEntry[];

  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap<ScheduleHistoryEntry>((item) => {
      if (!isRecord(item)) return [];
      const status = item.status === "error" ? "error" : "success";
      return [
        {
          id: typeof item.id === "string" ? item.id : generateId(),
          scheduleId: typeof item.scheduleId === "string" ? item.scheduleId : "",
          scheduleName:
            typeof item.scheduleName === "string" ? item.scheduleName : "Query schedule",
          ranAt: typeof item.ranAt === "number" ? item.ranAt : Date.now(),
          status,
          rowCount: typeof item.rowCount === "number" ? item.rowCount : 0,
          outputTable:
            typeof item.outputTable === "string" ? item.outputTable : "scheduled_output",
          message: typeof item.message === "string" ? item.message : "",
        },
      ];
    });
  } catch {
    return [];
  }
}
function stripTrailingSemicolon(sql: string) {
  return sql.trim().replace(/;+$/, "");
}

function StatusBanner({ message }: { message: StatusMessage | null }) {
  if (!message) return null;

  const toneClass =
    message.tone === "error"
      ? "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300"
      : message.tone === "success"
        ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
        : "border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300";

  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm ${toneClass}`}>
      {message.text}
    </div>
  );
}

export default function QueryScheduler({
  tableName,
  columns,
}: QuerySchedulerProps) {
  const [savedQueries] = useState<SavedQueryRecord[]>(() => readSavedQueries());
  const [schedules, setSchedules] = useState<QuerySchedule[]>(() => readSchedules());
  const [history, setHistory] = useState<ScheduleHistoryEntry[]>(() => readHistory());
  const [selectedQueryId, setSelectedQueryId] = useState(savedQueries[0]?.id ?? "");
  const [scheduleName, setScheduleName] = useState("");
  const [mode, setMode] = useState<ScheduleMode>("interval");
  const [intervalMinutes, setIntervalMinutes] = useState(15);
  const [cronExpression, setCronExpression] = useState("0 * * * *");
  const [outputTable, setOutputTable] = useState(`${tableName}_scheduled`);
  const [runningScheduleId, setRunningScheduleId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusMessage | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SCHEDULE_STORAGE_KEY, JSON.stringify(schedules));
  }, [schedules]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
  }, [history]);

  const selectedQuery = useMemo(
    () => savedQueries.find((query) => query.id === selectedQueryId) ?? savedQueries[0] ?? null,
    [savedQueries, selectedQueryId],
  );

  const executeSchedule = useCallback(
    async (scheduleId: string) => {
      const schedule = schedules.find((item) => item.id === scheduleId);
      if (!schedule) return;

      setRunningScheduleId(scheduleId);
      setStatus(null);

      try {
        const createTableSql = `
          CREATE OR REPLACE TABLE ${quoteIdentifier(schedule.outputTable)} AS
          ${stripTrailingSemicolon(schedule.sql)}
        `;
        await runQuery(createTableSql);
        const countRows = await runQuery(
          `SELECT COUNT(*) AS cnt FROM ${quoteIdentifier(schedule.outputTable)}`,
        );
        const rowCount = Number(countRows[0]?.cnt ?? 0);

        setSchedules((currentSchedules) =>
          currentSchedules.map((item) =>
            item.id === scheduleId ? { ...item, lastRunAt: Date.now() } : item,
          ),
        );
        const successEntry: ScheduleHistoryEntry = {
          id: generateId(),
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          ranAt: Date.now(),
          status: "success",
          rowCount,
          outputTable: schedule.outputTable,
          message: `Loaded ${rowCount} rows into ${schedule.outputTable}.`,
        };
        setHistory((currentHistory) => [successEntry, ...currentHistory].slice(0, 20));
        setStatus({
          tone: "success",
          text: `Executed ${schedule.name} and refreshed ${schedule.outputTable}.`,
        });
      } catch (error) {
        const errorEntry: ScheduleHistoryEntry = {
          id: generateId(),
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          ranAt: Date.now(),
          status: "error",
          rowCount: 0,
          outputTable: schedule.outputTable,
          message: error instanceof Error ? error.message : "Scheduled query failed.",
        };
        setHistory((currentHistory) => [errorEntry, ...currentHistory].slice(0, 20));
        setStatus({
          tone: "error",
          text: error instanceof Error ? error.message : "Scheduled query failed.",
        });
      } finally {
        setRunningScheduleId(null);
      }
    },
    [schedules],
  );

  useEffect(() => {
    const handles = schedules.flatMap((schedule) => {
      if (!schedule.enabled || schedule.mode !== "interval") return [];
      return [
        window.setInterval(() => {
          void executeSchedule(schedule.id);
        }, schedule.intervalMinutes * 60_000),
      ];
    });

    return () => {
      handles.forEach((handle) => window.clearInterval(handle));
    };
  }, [executeSchedule, schedules]);

  function handleCreateSchedule() {
    if (!selectedQuery) {
      setStatus({
        tone: "error",
        text: "Create or save a query first so it can be scheduled.",
      });
      return;
    }

    const nextSchedule: QuerySchedule = {
      id: generateId(),
      name: scheduleName.trim() || selectedQuery.name,
      queryId: selectedQuery.id,
      sql: selectedQuery.sql,
      outputTable: outputTable.trim() || `${tableName}_scheduled`,
      mode,
      intervalMinutes,
      cronExpression: cronExpression.trim() || "0 * * * *",
      enabled: true,
      createdAt: Date.now(),
      lastRunAt: null,
    };

    setSchedules((currentSchedules) => [nextSchedule, ...currentSchedules]);
    setScheduleName("");
    setStatus({
      tone: "success",
      text: `Added schedule ${nextSchedule.name}.`,
    });
  }

  function handleToggleSchedule(scheduleId: string) {
    setSchedules((currentSchedules) =>
      currentSchedules.map((schedule) =>
        schedule.id === scheduleId
          ? { ...schedule, enabled: !schedule.enabled }
          : schedule,
      ),
    );
  }

  function handleDeleteSchedule(scheduleId: string) {
    setSchedules((currentSchedules) =>
      currentSchedules.filter((schedule) => schedule.id !== scheduleId),
    );
    setHistory((currentHistory) =>
      currentHistory.filter((entry) => entry.scheduleId !== scheduleId),
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE }}
      className={`rounded-[2rem] p-6 shadow-[0_28px_90px_-52px_rgba(15,23,42,0.85)] ${GLASS_PANEL_CLASS}`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-300">
            <Clock3 className="h-3.5 w-3.5" />
            Query scheduler
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Schedule saved queries on intervals or cron-like plans
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Persist recurring query jobs in local storage, write results into DuckDB tables,
            and review run history for the active {tableName} workspace with {columns.length} columns.
          </p>
        </div>
        <div className={`rounded-3xl px-5 py-4 ${GLASS_PANEL_CLASS}`}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Saved queries
          </p>
          <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
            {savedQueries.length}
          </p>
        </div>
      </div>

      <div className="mt-6">
        <StatusBanner message={status} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className={`rounded-[1.75rem] p-5 ${GLASS_PANEL_CLASS}`}>
          <div className="grid gap-4">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Saved query
              </span>
              <select
                aria-label="Saved query"
                className={FIELD_CLASS}
                value={selectedQuery?.id ?? ""}
                onChange={(event) => setSelectedQueryId(event.target.value)}
              >
                {savedQueries.map((query) => (
                  <option key={query.id} value={query.id}>
                    {query.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Schedule name
              </span>
              <input
                aria-label="Schedule name"
                className={FIELD_CLASS}
                value={scheduleName}
                onChange={(event) => setScheduleName(event.target.value)}
                placeholder={selectedQuery?.name ?? "Query schedule"}
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Mode
                </span>
                <select
                  aria-label="Schedule mode"
                  className={FIELD_CLASS}
                  value={mode}
                  onChange={(event) => setMode(event.target.value as ScheduleMode)}
                >
                  <option value="interval">Interval</option>
                  <option value="cron">Cron expression</option>
                </select>
              </label>

              {mode === "interval" ? (
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Interval (minutes)
                  </span>
                  <input
                    aria-label="Interval minutes"
                    className={FIELD_CLASS}
                    min={1}
                    type="number"
                    value={intervalMinutes}
                    onChange={(event) =>
                      setIntervalMinutes(Math.max(1, Number(event.target.value)))
                    }
                  />
                </label>
              ) : (
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Cron expression
                  </span>
                  <input
                    aria-label="Cron expression"
                    className={FIELD_CLASS}
                    value={cronExpression}
                    onChange={(event) => setCronExpression(event.target.value)}
                  />
                </label>
              )}
            </div>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Output table
              </span>
              <input
                aria-label="Output table"
                className={FIELD_CLASS}
                value={outputTable}
                onChange={(event) => setOutputTable(event.target.value)}
              />
            </label>

            <button
              type="button"
              onClick={handleCreateSchedule}
              disabled={!selectedQuery}
              className={`${BUTTON_CLASS} bg-cyan-600 text-white hover:bg-cyan-500`}
            >
              <Plus className="h-4 w-4" />
              Add schedule
            </button>
          </div>
        </div>

        <div className="grid gap-6">
          <div className={`rounded-[1.75rem] p-5 ${GLASS_PANEL_CLASS}`}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
                  Active schedules
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Enable or disable recurring runs and push results into output tables.
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {schedules.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-white/25 bg-white/35 p-8 text-sm text-slate-600 dark:bg-slate-950/25 dark:text-slate-300">
                  No schedules yet. Save a query, configure its cadence, and add it here.
                </div>
              ) : (
                schedules.map((schedule) => (
                  <div
                    key={schedule.id}
                    className="rounded-3xl border border-white/20 bg-white/60 p-4 dark:bg-slate-950/35"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <p className="text-base font-semibold text-slate-950 dark:text-white">
                          {schedule.name}
                        </p>
                        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                          {schedule.mode === "interval"
                            ? `Every ${schedule.intervalMinutes} minutes`
                            : `Cron: ${schedule.cronExpression}`}
                        </p>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                          Output: {schedule.outputTable}
                          {schedule.lastRunAt ? ` • Last run ${formatRelativeTime(schedule.lastRunAt)}` : ""}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          aria-label={`Toggle ${schedule.name}`}
                          onClick={() => handleToggleSchedule(schedule.id)}
                          className={`${BUTTON_CLASS} border border-white/20 bg-white/70 text-slate-800 hover:bg-white dark:bg-slate-950/45 dark:text-slate-100 dark:hover:bg-slate-950/60`}
                        >
                          {schedule.enabled ? (
                            <ToggleRight className="h-4 w-4 text-emerald-500" />
                          ) : (
                            <ToggleLeft className="h-4 w-4 text-slate-400" />
                          )}
                          {schedule.enabled ? "Enabled" : "Disabled"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void executeSchedule(schedule.id)}
                          disabled={runningScheduleId === schedule.id}
                          className={`${BUTTON_CLASS} border border-white/20 bg-white/70 text-slate-800 hover:bg-white dark:bg-slate-950/45 dark:text-slate-100 dark:hover:bg-slate-950/60`}
                        >
                          {runningScheduleId === schedule.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                          Run now
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSchedule(schedule.id)}
                          className={`${BUTTON_CLASS} border border-rose-500/20 bg-rose-500/10 text-rose-700 hover:bg-rose-500/20 dark:text-rose-300`}
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className={`rounded-[1.75rem] p-5 ${GLASS_PANEL_CLASS}`}>
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
              <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
                Run history
              </h3>
            </div>

            <div className="mt-5 space-y-3">
              {history.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-white/25 bg-white/35 p-8 text-sm text-slate-600 dark:bg-slate-950/25 dark:text-slate-300">
                  Scheduled runs will appear here after you execute a query.
                </div>
              ) : (
                history.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-3xl border border-white/20 bg-white/60 p-4 dark:bg-slate-950/35"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-950 dark:text-white">
                          {entry.scheduleName}
                        </p>
                        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                          {entry.message}
                        </p>
                      </div>
                      <div className="text-right text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        <p>{entry.status}</p>
                        <p className="mt-1 normal-case">{formatRelativeTime(entry.ranAt)}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
