"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlarmClock,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Plus,
  Trash2,
} from "lucide-react";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
} from "@/lib/utils/advanced-analytics";
import { REPORT_TEMPLATES, type ReportTemplateId } from "@/components/report/report-templates";

type ScheduleFrequency = "daily" | "weekly" | "monthly";

interface ScheduledReport {
  id: string;
  reportName: string;
  templateId: ReportTemplateId;
  frequency: ScheduleFrequency;
  dayOfWeek: number;
  dayOfMonth: number;
  time: string;
  enabled: boolean;
  createdAt: number;
}

const STORAGE_KEY = "datalens-report-scheduler";
const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTemplateId(value: unknown): value is ReportTemplateId {
  return (
    typeof value === "string" &&
    REPORT_TEMPLATES.some((template) => template.id === value)
  );
}

function isScheduleFrequency(value: unknown): value is ScheduleFrequency {
  return value === "daily" || value === "weekly" || value === "monthly";
}

function createScheduleId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readSchedules(): ScheduledReport[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap<ScheduledReport>((entry) => {
      if (!isRecord(entry) || !isTemplateId(entry.templateId) || !isScheduleFrequency(entry.frequency)) {
        return [];
      }

      const reportName =
        typeof entry.reportName === "string" && entry.reportName.trim().length > 0
          ? entry.reportName
          : "Scheduled report";
      const dayOfWeek = Number(entry.dayOfWeek);
      const dayOfMonth = Number(entry.dayOfMonth);
      const createdAt = Number(entry.createdAt);

      return [
        {
          id: typeof entry.id === "string" ? entry.id : createScheduleId(),
          reportName,
          templateId: entry.templateId,
          frequency: entry.frequency,
          dayOfWeek:
            Number.isInteger(dayOfWeek) && dayOfWeek >= 0 && dayOfWeek <= 6
              ? dayOfWeek
              : 1,
          dayOfMonth:
            Number.isInteger(dayOfMonth) && dayOfMonth >= 1 && dayOfMonth <= 28
              ? dayOfMonth
              : 1,
          time:
            typeof entry.time === "string" && /^\d{2}:\d{2}$/.test(entry.time)
              ? entry.time
              : "09:00",
          enabled: entry.enabled !== false,
          createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
        },
      ];
    });
  } catch {
    return [];
  }
}

function persistSchedules(schedules: ScheduledReport[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(schedules));
}

function formatNextRun(schedule: ScheduledReport) {
  if (schedule.frequency === "daily") {
    return `Daily at ${schedule.time}`;
  }

  if (schedule.frequency === "weekly") {
    return `Weekly on ${WEEKDAY_LABELS[schedule.dayOfWeek]} at ${schedule.time}`;
  }

  return `Monthly on day ${schedule.dayOfMonth} at ${schedule.time}`;
}

function SchedulerRow({
  schedule,
  onDelete,
  onToggle,
}: {
  schedule: ScheduledReport;
  onDelete: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const template =
    REPORT_TEMPLATES.find((item) => item.id === schedule.templateId) ??
    REPORT_TEMPLATES[0];

  return (
    <div className={`${GLASS_CARD_CLASS} flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between`}>
      <div>
        <div className="flex items-center gap-3">
          <p className="text-base font-semibold text-slate-950 dark:text-white">
            {schedule.reportName}
          </p>
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${
              schedule.enabled
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                : "bg-slate-200/70 text-slate-600 dark:bg-slate-800/70 dark:text-slate-300"
            }`}
          >
            {schedule.enabled ? "Enabled" : "Paused"}
          </span>
        </div>
        <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
          {template.name} · {formatNextRun(schedule)}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onToggle(schedule.id)}
          className={`${BUTTON_CLASS} ${
            schedule.enabled ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : ""
          }`}
        >
          <CheckCircle2 className="h-4 w-4" />
          {schedule.enabled ? "Disable" : "Enable"}
        </button>
        <button
          type="button"
          onClick={() => onDelete(schedule.id)}
          className={`${BUTTON_CLASS} text-rose-700 dark:text-rose-300`}
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </button>
      </div>
    </div>
  );
}

export default function ReportScheduler() {
  const [schedules, setSchedules] = useState<ScheduledReport[]>(() => readSchedules());
  const [reportName, setReportName] = useState("Weekly executive summary");
  const [templateId, setTemplateId] = useState<ReportTemplateId>("executive-summary");
  const [frequency, setFrequency] = useState<ScheduleFrequency>("weekly");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [time, setTime] = useState("09:00");

  const enabledCount = useMemo(
    () => schedules.filter((schedule) => schedule.enabled).length,
    [schedules],
  );

  function updateSchedules(
    updater: (current: ScheduledReport[]) => ScheduledReport[],
  ) {
    setSchedules((current) => {
      const next = updater(current);
      persistSchedules(next);
      return next;
    });
  }

  function addSchedule() {
    const trimmedName = reportName.trim();
    if (!trimmedName) return;

    updateSchedules((current) => [
      {
        id: createScheduleId(),
        reportName: trimmedName,
        templateId,
        frequency,
        dayOfWeek,
        dayOfMonth,
        time,
        enabled: true,
        createdAt: Date.now(),
      },
      ...current,
    ]);
  }

  function deleteSchedule(id: string) {
    updateSchedules((current) => current.filter((schedule) => schedule.id !== id));
  }

  function toggleSchedule(id: string) {
    updateSchedules((current) =>
      current.map((schedule) =>
        schedule.id === id
          ? {
              ...schedule,
              enabled: !schedule.enabled,
            }
          : schedule,
      ),
    );
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-violet-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-300">
            <CalendarClock className="h-3.5 w-3.5" />
            Report scheduler
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Keep recurring reports on a predictable cadence
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Save a local delivery schedule for repeat report generation. Frequency, timing, and
            enablement state are persisted in localStorage.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className={`${GLASS_CARD_CLASS} min-w-[10rem] p-4`}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Active schedules
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
              {enabledCount}
            </p>
          </div>
          <div className={`${GLASS_CARD_CLASS} min-w-[10rem] p-4`}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Total saved
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
              {schedules.length}
            </p>
          </div>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
        className={`${GLASS_CARD_CLASS} mt-6 p-5`}
      >
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
          <AlarmClock className="h-4 w-4 text-violet-500" />
          New schedule
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <label className="xl:col-span-2">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Report name
            </span>
            <input
              value={reportName}
              onChange={(event) => setReportName(event.target.value)}
              className={FIELD_CLASS}
              placeholder="Weekly executive summary"
            />
          </label>

          <label>
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Template
            </span>
            <select
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value as ReportTemplateId)}
              className={FIELD_CLASS}
            >
              {REPORT_TEMPLATES.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Frequency
            </span>
            <select
              value={frequency}
              onChange={(event) => setFrequency(event.target.value as ScheduleFrequency)}
              className={FIELD_CLASS}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>

          <label>
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Time
            </span>
            <input
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              className={FIELD_CLASS}
            />
          </label>

          {frequency === "weekly" ? (
            <label>
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Day of week
              </span>
              <select
                value={dayOfWeek}
                onChange={(event) => setDayOfWeek(Number(event.target.value))}
                className={FIELD_CLASS}
              >
                {WEEKDAY_LABELS.map((label, index) => (
                  <option key={label} value={index}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          ) : frequency === "monthly" ? (
            <label>
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Day of month
              </span>
              <select
                value={dayOfMonth}
                onChange={(event) => setDayOfMonth(Number(event.target.value))}
                className={FIELD_CLASS}
              >
                {Array.from({ length: 28 }, (_, index) => index + 1).map((day) => (
                  <option key={day} value={day}>
                    Day {day}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className={`${GLASS_CARD_CLASS} flex items-center gap-3 p-4`}>
              <Clock3 className="h-5 w-5 text-violet-500" />
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  Daily cadence
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Runs every day at the selected time.
                </p>
              </div>
            </div>
          )}
        </div>

        <button type="button" onClick={addSchedule} className={`${BUTTON_CLASS} mt-5`}>
          <Plus className="h-4 w-4" />
          Add schedule
        </button>
      </motion.div>

      <div className="mt-6 space-y-4">
        {schedules.length === 0 ? (
          <div className={`${GLASS_CARD_CLASS} p-6 text-sm text-slate-600 dark:text-slate-300`}>
            No report schedules saved yet. Create a cadence above to keep recurring reporting
            organized locally.
          </div>
        ) : (
          schedules.map((schedule) => (
            <SchedulerRow
              key={schedule.id}
              schedule={schedule}
              onDelete={deleteSchedule}
              onToggle={toggleSchedule}
            />
          ))
        )}
      </div>
    </section>
  );
}
