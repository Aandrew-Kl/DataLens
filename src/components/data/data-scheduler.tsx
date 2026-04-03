"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Loader2,
  Play,
  RefreshCw,
  ShieldAlert,
  Timer,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface DataSchedulerProps {
  tableName: string;
  columns: ColumnProfile[];
}

type TaskType = "refresh_data" | "run_pipeline" | "generate_report" | "check_alerts";
type ScheduleMode = "minutes" | "hours" | "daily" | "weekly";

interface TaskSchedule {
  mode: ScheduleMode;
  every: number;
  time: string;
  weekday: number;
}

interface TaskHistoryEntry {
  id: string;
  startedAt: number;
  status: "success" | "error";
  durationMs: number;
  rowCount: number;
  message: string;
}

interface ScheduledTask {
  id: string;
  name: string;
  type: TaskType;
  enabled: boolean;
  notifications: boolean;
  createdAt: number;
  nextRunAt: number;
  schedule: TaskSchedule;
  history: TaskHistoryEntry[];
}

const STORAGE_KEY_PREFIX = "datalens:scheduler:";
const EASE = [0.22, 1, 0.36, 1] as const;
const CARD_CLASS =
  "rounded-[1.75rem] border border-white/20 bg-white/75 shadow-xl shadow-slate-950/10 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const TASK_LABELS: Record<TaskType, string> = {
  refresh_data: "Refresh data",
  run_pipeline: "Run pipeline",
  generate_report: "Generate report",
  check_alerts: "Check alerts",
} as const;
const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

function storageKey(tableName: string): string {
  return `${STORAGE_KEY_PREFIX}${tableName}`;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function readTasks(tableName: string): ScheduledTask[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(tableName));
    return raw ? (JSON.parse(raw) as ScheduledTask[]) : [];
  } catch {
    return [];
  }
}

function persistTasks(tableName: string, tasks: ScheduledTask[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(tableName), JSON.stringify(tasks));
}

function createTaskId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toTimeParts(value: string): { hours: number; minutes: number } {
  const [hours, minutes] = value.split(":").map((part) => Number(part));
  return {
    hours: Number.isFinite(hours) ? hours : 9,
    minutes: Number.isFinite(minutes) ? minutes : 0,
  };
}

function computeNextRun(schedule: TaskSchedule, from: number): number {
  const base = new Date(from);

  if (schedule.mode === "minutes") {
    return from + schedule.every * 60_000;
  }

  if (schedule.mode === "hours") {
    return from + schedule.every * 60 * 60_000;
  }

  if (schedule.mode === "daily") {
    const next = new Date(base);
    const { hours, minutes } = toTimeParts(schedule.time);
    next.setHours(hours, minutes, 0, 0);
    if (next.getTime() <= from) {
      next.setDate(next.getDate() + Math.max(schedule.every, 1));
    }
    return next.getTime();
  }

  const weekly = new Date(base);
  const { hours, minutes } = toTimeParts(schedule.time);
  weekly.setHours(hours, minutes, 0, 0);
  const deltaDays = (schedule.weekday - weekly.getDay() + 7) % 7;
  weekly.setDate(weekly.getDate() + deltaDays);
  if (weekly.getTime() <= from) {
    weekly.setDate(weekly.getDate() + 7 * Math.max(schedule.every, 1));
  }
  return weekly.getTime();
}

function formatSchedule(schedule: TaskSchedule): string {
  if (schedule.mode === "minutes") return `Every ${schedule.every} minute(s)`;
  if (schedule.mode === "hours") return `Every ${schedule.every} hour(s)`;
  if (schedule.mode === "daily") return `Daily at ${schedule.time}`;
  return `Weekly on ${WEEKDAY_LABELS[schedule.weekday]} at ${schedule.time}`;
}

function formatDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1000).toFixed(2)} s`;
}

function TaskCard({
  activeRunId,
  onRun,
  onToggle,
  task,
}: {
  activeRunId: string | null;
  onRun: (taskId: string) => void;
  onToggle: (taskId: string) => void;
  task: ScheduledTask;
}) {
  const running = activeRunId === task.id;
  const latestHistory = task.history[0] ?? null;

  return (
    <div className="rounded-[1.3rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">{task.name}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {TASK_LABELS[task.type]} · {formatSchedule(task.schedule)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onRun(task.id)}
            className="inline-flex items-center gap-2 rounded-[0.95rem] border border-white/15 bg-white/55 px-3 py-2 text-sm text-slate-700 transition hover:bg-white/70 dark:bg-slate-950/35 dark:text-slate-200"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running ? "Running" : "Run now"}
          </button>
          <button
            type="button"
            onClick={() => onToggle(task.id)}
            className={`inline-flex items-center gap-2 rounded-[0.95rem] px-3 py-2 text-sm font-medium transition ${
              task.enabled
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                : "bg-slate-200/70 text-slate-700 dark:bg-slate-800/70 dark:text-slate-300"
            }`}
          >
            <CheckCircle2 className="h-4 w-4" />
            {task.enabled ? "Enabled" : "Disabled"}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-[1rem] border border-white/15 bg-white/55 px-4 py-3 dark:bg-slate-950/25">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            Next run
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-50">
            {formatDateTime(task.nextRunAt)}
          </p>
        </div>
        <div className="rounded-[1rem] border border-white/15 bg-white/55 px-4 py-3 dark:bg-slate-950/25">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            Notifications
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-50">
            {task.notifications ? "Browser enabled" : "Off"}
          </p>
        </div>
        <div className="rounded-[1rem] border border-white/15 bg-white/55 px-4 py-3 dark:bg-slate-950/25">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            Last run
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-50">
            {latestHistory ? formatDateTime(latestHistory.startedAt) : "No runs yet"}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function DataScheduler({ tableName, columns }: DataSchedulerProps) {
  const runningTaskIdsRef = useRef<Set<string>>(new Set());
  const [tasks, setTasks] = useState<ScheduledTask[]>(() => readTasks(tableName));
  const [taskName, setTaskName] = useState("Daily refresh");
  const [taskType, setTaskType] = useState<TaskType>("refresh_data");
  const [mode, setMode] = useState<ScheduleMode>("daily");
  const [every, setEvery] = useState(1);
  const [time, setTime] = useState("09:00");
  const [weekday, setWeekday] = useState(1);
  const [notifications, setNotifications] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const timelineEntries = useMemo(
    () =>
      [...tasks]
        .filter((task) => task.enabled)
        .sort((left, right) => left.nextRunAt - right.nextRunAt)
        .slice(0, 8),
    [tasks],
  );

  const taskHistory = useMemo(
    () =>
      tasks
        .flatMap((task) => task.history.map((entry) => ({ ...entry, taskName: task.name })))
        .sort((left, right) => right.startedAt - left.startedAt)
        .slice(0, 10),
    [tasks],
  );

  useEffect(() => {
    persistTasks(tableName, tasks);
  }, [tableName, tasks]);

  const triggerScheduledRun = useEffectEvent((taskId: string) => {
    void runTask(taskId, true);
  });

  useEffect(() => {
    const interval = window.setInterval(() => {
      const dueTasks = tasks.filter(
        (task) =>
          task.enabled &&
          task.nextRunAt <= Date.now() &&
          !runningTaskIdsRef.current.has(task.id),
      );

      dueTasks.forEach((task) => {
        triggerScheduledRun(task.id);
      });
    }, 5000);

    return () => window.clearInterval(interval);
  }, [tasks]);

  async function requestNotificationPermission() {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setNotice("Browser notifications are not supported in this environment.");
      return;
    }

    const permission = await Notification.requestPermission();
    setNotifications(permission === "granted");
    setNotice(
      permission === "granted"
        ? "Browser notifications enabled."
        : "Notifications remain disabled.",
    );
  }

  function addTask() {
    const trimmedName = taskName.trim();
    if (!trimmedName) {
      setNotice("Task name is required.");
      return;
    }

    const schedule: TaskSchedule = { mode, every: Math.max(every, 1), time, weekday };
    const task: ScheduledTask = {
      id: createTaskId(),
      name: trimmedName,
      type: taskType,
      enabled: true,
      notifications,
      createdAt: Date.now(),
      nextRunAt: computeNextRun(schedule, Date.now()),
      schedule,
      history: [],
    };

    setTasks((current) => [task, ...current]);
    setNotice(`Scheduled ${trimmedName}.`);
  }

  function toggleTask(taskId: string) {
    setTasks((current) =>
      current.map((task) =>
        task.id === taskId
          ? {
              ...task,
              enabled: !task.enabled,
              nextRunAt: !task.enabled
                ? computeNextRun(task.schedule, Date.now())
                : task.nextRunAt,
            }
          : task,
      ),
    );
  }

  async function runTask(taskId: string, scheduledRun: boolean) {
    const task = tasks.find((entry) => entry.id === taskId);
    if (!task || runningTaskIdsRef.current.has(taskId)) return;

    runningTaskIdsRef.current.add(taskId);
    setActiveRunId(taskId);
    const startedAt = performance.now();

    try {
      const rowCountQuery =
        task.type === "check_alerts" && columns[0]
          ? `SELECT COUNT(*) AS row_count, COUNT(*) FILTER (WHERE ${quoteIdentifier(columns[0].name)} IS NULL) AS matched_rows FROM ${quoteIdentifier(tableName)}`
          : `SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(tableName)}`;

      const rows = await runQuery(rowCountQuery);
      const rowCount = Number(rows[0]?.row_count ?? 0);
      const matchedRows = Number(rows[0]?.matched_rows ?? rowCount);
      const durationMs = performance.now() - startedAt;
      const message =
        task.type === "check_alerts"
          ? `${formatNumber(matchedRows)} alert conditions evaluated.`
          : `${formatNumber(rowCount)} rows processed.`;
      const historyEntry: TaskHistoryEntry = {
        id: createTaskId(),
        startedAt: Date.now(),
        status: "success",
        durationMs,
        rowCount,
        message,
      };

      setTasks((current) =>
        current.map((entry) =>
          entry.id === taskId
            ? {
                ...entry,
                nextRunAt: computeNextRun(entry.schedule, Date.now()),
                history: [historyEntry, ...entry.history].slice(0, 10),
              }
            : entry,
        ),
      );

      if (
        task.notifications &&
        typeof window !== "undefined" &&
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        new Notification(`DataLens task: ${task.name}`, {
          body: message,
        });
      }

      setNotice(scheduledRun ? `Scheduled run completed for ${task.name}.` : `Manual run completed for ${task.name}.`);
    } catch (error) {
      const durationMs = performance.now() - startedAt;
      const historyEntry: TaskHistoryEntry = {
        id: createTaskId(),
        startedAt: Date.now(),
        status: "error",
        durationMs,
        rowCount: 0,
        message: error instanceof Error ? error.message : "Task failed.",
      };

      setTasks((current) =>
        current.map((entry) =>
          entry.id === taskId
            ? {
                ...entry,
                nextRunAt: computeNextRun(entry.schedule, Date.now()),
                history: [historyEntry, ...entry.history].slice(0, 10),
              }
            : entry,
        ),
      );
      setNotice(historyEntry.message);
    } finally {
      runningTaskIdsRef.current.delete(taskId);
      setActiveRunId((current) => (current === taskId ? null : current));
    }
  }

  return (
    <section className={`${CARD_CLASS} overflow-hidden p-5`}>
      <div className="flex flex-col gap-5 border-b border-white/15 pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-[1.25rem] bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
            <CalendarClock className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
              Data Scheduler
            </p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950 dark:text-slate-50">
              In-browser automation for {tableName}
            </h2>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void requestNotificationPermission()}
          className="inline-flex items-center gap-2 rounded-[1rem] border border-white/15 bg-white/45 px-4 py-3 text-sm text-slate-700 transition hover:bg-white/60 dark:bg-slate-900/30 dark:text-slate-200"
        >
          <Bell className="h-4 w-4" />
          {notifications ? "Notifications enabled" : "Enable notifications"}
        </button>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-4">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: EASE }}
            className="rounded-[1.4rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30"
          >
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
              Create a scheduled task
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <input
                value={taskName}
                onChange={(event) => setTaskName(event.target.value)}
                placeholder="Task name"
                className="rounded-[1rem] border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-900 outline-none dark:bg-slate-950/60 dark:text-slate-50"
              />
              <select
                value={taskType}
                onChange={(event) => setTaskType(event.target.value as TaskType)}
                className="rounded-[1rem] border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-900 outline-none dark:bg-slate-950/60 dark:text-slate-50"
              >
                {(Object.keys(TASK_LABELS) as TaskType[]).map((type) => (
                  <option key={type} value={type}>
                    {TASK_LABELS[type]}
                  </option>
                ))}
              </select>
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value as ScheduleMode)}
                className="rounded-[1rem] border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-900 outline-none dark:bg-slate-950/60 dark:text-slate-50"
              >
                <option value="minutes">Every N minutes</option>
                <option value="hours">Every N hours</option>
                <option value="daily">Daily at time</option>
                <option value="weekly">Weekly on day</option>
              </select>
              <input
                type="number"
                min={1}
                value={every}
                onChange={(event) => setEvery(Math.max(Number(event.target.value), 1))}
                className="rounded-[1rem] border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-900 outline-none dark:bg-slate-950/60 dark:text-slate-50"
              />
              <input
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                className="rounded-[1rem] border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-900 outline-none dark:bg-slate-950/60 dark:text-slate-50"
              />
              <select
                value={weekday}
                onChange={(event) => setWeekday(Number(event.target.value))}
                className="rounded-[1rem] border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-900 outline-none dark:bg-slate-950/60 dark:text-slate-50"
              >
                {WEEKDAY_LABELS.map((label, index) => (
                  <option key={label} value={index}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={addTask}
              className="mt-4 inline-flex items-center gap-2 rounded-[1rem] bg-cyan-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500"
            >
              <Timer className="h-4 w-4" />
              Create task
            </button>
          </motion.div>

          <div className="space-y-3">
            {tasks.length === 0 ? (
              <div className="rounded-[1.3rem] border border-dashed border-white/20 px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                No scheduled tasks yet. Configure one above to start periodic runs.
              </div>
            ) : (
              tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  activeRunId={activeRunId}
                  onRun={(taskId) => void runTask(taskId, false)}
                  onToggle={toggleTask}
                  task={task}
                />
              ))
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-[1.4rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30">
            <div className="flex items-center gap-3">
              <Clock3 className="h-4 w-4 text-slate-500 dark:text-slate-400" />
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                Upcoming run timeline
              </p>
            </div>
            <div className="mt-4 space-y-3">
              {timelineEntries.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Enable a task to see the next scheduled runs.
                </p>
              ) : (
                timelineEntries.map((task) => (
                  <div
                    key={task.id}
                    className="rounded-[1rem] border border-white/15 bg-white/55 px-4 py-3 dark:bg-slate-950/25"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                        {task.name}
                      </p>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {formatSchedule(task.schedule)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                      {formatDateTime(task.nextRunAt)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-[1.4rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30">
            <div className="flex items-center gap-3">
              <RefreshCw className="h-4 w-4 text-slate-500 dark:text-slate-400" />
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                Last 10 task runs
              </p>
            </div>
            <div className="mt-4 space-y-3">
              {taskHistory.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Run a task once to populate the history log.
                </p>
              ) : (
                taskHistory.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-[1rem] border border-white/15 bg-white/55 px-4 py-3 dark:bg-slate-950/25"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                        {entry.taskName}
                      </p>
                      <span
                        className={`text-xs font-medium ${
                          entry.status === "success"
                            ? "text-emerald-600 dark:text-emerald-300"
                            : "text-rose-600 dark:text-rose-300"
                        }`}
                      >
                        {entry.status}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                      {entry.message}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500 dark:text-slate-400">
                      <span>{formatDateTime(entry.startedAt)}</span>
                      <span>{formatDuration(entry.durationMs)}</span>
                      <span>{formatNumber(entry.rowCount)} rows</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <AnimatePresence mode="wait">
            {notice ? (
              <motion.div
                key={notice}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.24, ease: EASE }}
                className="rounded-[1.2rem] border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-800 dark:text-cyan-300"
              >
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4" />
                  <span>{notice}</span>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
