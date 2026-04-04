"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";

import { useDatasetStore } from "@/stores/dataset-store";

type ExportFormat = "pdf" | "excel";
type ScheduleFrequency = "daily" | "weekly" | "monthly";

interface ReportTemplate {
  id: string;
  title: string;
  description: string;
  scope: string;
}

interface SavedReport {
  id: string;
  title: string;
  templateId: string;
  format: ExportFormat;
  createdAt: string;
  status: "generated" | "scheduled" | "failed";
}

interface ScheduledReport {
  id: string;
  templateId: string;
  frequency: ScheduleFrequency;
  runTime: string;
  runDay: string;
  formats: ExportFormat[];
  createdAt: string;
}

const glass =
  "rounded-2xl border border-white/30 bg-white/60 p-5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/60";

const templates: ReportTemplate[] = [
  {
    id: "executive-summary",
    title: "Executive Summary",
    description: "Snapshot of KPIs, trend direction and anomalies.",
    scope: "all datasets",
  },
  {
    id: "drill-down",
    title: "Drill-down Dataset Report",
    description: "Detailed per-column quality and value distribution.",
    scope: "active dataset",
  },
  {
    id: "scheduler-audit",
    title: "Data Operations Audit",
    description: "Upload history, transformations applied and dataset status.",
    scope: "operations log",
  },
];

const historyStorageKey = "datalens-report-history-v1";
const scheduleStorageKey = "datalens-report-schedules-v1";

function newId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function TemplateCard({
  template,
  selected,
  onSelect,
}: {
  template: ReportTemplate;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-2xl border p-4 text-left ${
        selected ? "border-cyan-400 bg-cyan-50 dark:bg-slate-950/50" : "border-white/40 bg-white/45 dark:border-white/15"
      }`}
    >
      <p className="font-semibold text-slate-900 dark:text-slate-100">{template.title}</p>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{template.description}</p>
      <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">Scope: {template.scope}</p>
    </button>
  );
}

export default function ReportsPage() {
  const datasets = useDatasetStore((state) => state.datasets);
  const activeDatasetId = useDatasetStore((state) => state.activeDatasetId);
  const activeDataset = useMemo(
    () => datasets.find((dataset) => dataset.id === activeDatasetId) ?? null,
    [activeDatasetId, datasets],
  );

  const [selectedTemplateId, setSelectedTemplateId] = useState(templates[0].id);
  const [exportFormats, setExportFormats] = useState<ExportFormat[]>(["pdf"]);
  const [frequency, setFrequency] = useState<ScheduleFrequency>("daily");
  const [runTime, setRunTime] = useState("09:00");
  const [runDay, setRunDay] = useState("Monday");
  const [history, setHistory] = useState<SavedReport[]>([]);
  const [schedules, setSchedules] = useState<ScheduledReport[]>([]);
  const initialPersistSnapshot = useRef<{
    history: SavedReport[];
    schedules: ScheduledReport[];
  } | null>(null);
  const skipInitialPersist = useRef(true);

  useEffect(() => {
    let nextHistory: SavedReport[] | null = null;
    const savedHistory = window.localStorage.getItem(historyStorageKey);
    if (savedHistory) {
      try {
        nextHistory = JSON.parse(savedHistory) as SavedReport[];
      } catch {
        // Ignore invalid cache data.
      }
    }

    let nextSchedules: ScheduledReport[] | null = null;
    const savedSchedules = window.localStorage.getItem(scheduleStorageKey);
    if (savedSchedules) {
      try {
        nextSchedules = JSON.parse(savedSchedules) as ScheduledReport[];
      } catch {
        // Ignore invalid cache data.
      }
    }

    initialPersistSnapshot.current = {
      history: nextHistory ?? [],
      schedules: nextSchedules ?? [],
    };

    if (nextHistory === null && nextSchedules === null) {
      return;
    }

    startTransition(() => {
      if (nextHistory !== null) {
        setHistory(nextHistory);
      }
      if (nextSchedules !== null) {
        setSchedules(nextSchedules);
      }
    });
  }, []);

  useEffect(() => {
    if (skipInitialPersist.current) {
      skipInitialPersist.current = false;
      window.localStorage.setItem(
        historyStorageKey,
        JSON.stringify(initialPersistSnapshot.current?.history ?? history),
      );
      window.localStorage.setItem(
        scheduleStorageKey,
        JSON.stringify(initialPersistSnapshot.current?.schedules ?? schedules),
      );
      return;
    }

    window.localStorage.setItem(historyStorageKey, JSON.stringify(history));
    window.localStorage.setItem(scheduleStorageKey, JSON.stringify(schedules));
  }, [history, schedules]);

  const generateReport = (format: ExportFormat) => {
    const template = templates.find((item) => item.id === selectedTemplateId);
    const next: SavedReport = {
      id: newId("report"),
      title: `${template?.title ?? "Report"} - ${format.toUpperCase()}`,
      templateId: selectedTemplateId,
      format,
      createdAt: new Date().toISOString(),
      status: activeDataset ? "generated" : "failed",
    };
    setHistory((current) => [next, ...current]);
  };

  const scheduleReport = () => {
    const next: ScheduledReport = {
      id: newId("schedule"),
      templateId: selectedTemplateId,
      frequency,
      runTime,
      runDay,
      formats: [...exportFormats],
      createdAt: new Date().toISOString(),
    };
    setSchedules((current) => [next, ...current]);
  };

  const removeSchedule = (id: string) => {
    setSchedules((current) => current.filter((entry) => entry.id !== id));
  };

  const currentTemplate = templates.find((item) => item.id === selectedTemplateId);

  const toggleFormat = (format: ExportFormat) => {
    setExportFormats((current) =>
      current.includes(format) ? current.filter((item) => item !== format) : [...current, format],
    );
  };

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Reports</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Build report templates, export to PDF/Excel, schedule delivery, and inspect history.
        </p>
      </header>

      <section className={glass}>
        <h2 className="mb-3 text-base font-semibold">Report templates</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              selected={template.id === selectedTemplateId}
              onSelect={() => setSelectedTemplateId(template.id)}
            />
          ))}
        </div>
        <p className="mt-3 rounded-2xl border border-cyan-300/30 bg-cyan-50 p-3 text-sm text-cyan-800 dark:bg-slate-950/60 dark:text-cyan-200">
          Selected: {currentTemplate?.title}
        </p>
      </section>

      <section className={glass}>
        <h2 className="mb-3 text-base font-semibold">Export settings</h2>
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
          Choose one or more export formats for generation and schedule jobs.
        </p>
        <div className="mb-4 flex flex-wrap gap-2">
          {(["pdf", "excel"] as ExportFormat[]).map((format) => {
            const active = exportFormats.includes(format);
            return (
              <label
                key={format}
                className={`inline-flex cursor-pointer items-center gap-2 rounded-2xl border px-4 py-2 text-sm ${
                  active ? "border-cyan-300 bg-cyan-50 dark:bg-slate-950/60" : "border-white/40"
                }`}
              >
                <input type="checkbox" checked={active} onChange={() => toggleFormat(format)} />
                <span className="uppercase">{format}</span>
              </label>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              exportFormats.forEach((format) => generateReport(format));
            }}
            className="rounded-2xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500"
          >
            Export now
          </button>
          <p className="rounded-2xl border border-white/40 bg-white/45 px-4 py-2 text-xs text-slate-700 dark:text-slate-300">
            {activeDataset ? `Active dataset: ${activeDataset.name}` : "No dataset selected"}
          </p>
        </div>
      </section>

      <section className={glass}>
        <h2 className="mb-3 text-base font-semibold">Schedule report generation</h2>
        <div className="grid gap-3 md:grid-cols-4">
          <label className="flex flex-col gap-2">
            <span className="text-sm">Frequency</span>
            <select
              value={frequency}
              onChange={(event) => setFrequency(event.target.value as ScheduleFrequency)}
              className="rounded-2xl border border-white/40 bg-white/50 p-2.5 text-sm dark:bg-slate-950/50"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm">Run time</span>
            <input
              type="time"
              value={runTime}
              onChange={(event) => setRunTime(event.target.value)}
              className="rounded-2xl border border-white/40 bg-white/50 p-2.5 text-sm dark:bg-slate-950/50"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm">Run day</span>
            <input
              value={runDay}
              onChange={(event) => setRunDay(event.target.value)}
              className="rounded-2xl border border-white/40 bg-white/50 p-2.5 text-sm dark:bg-slate-950/50"
            />
          </label>

          <div className="flex items-end">
            <button
              type="button"
              onClick={scheduleReport}
              className="w-full rounded-2xl border border-white/40 bg-white/50 px-4 py-2 text-sm font-semibold hover:bg-white/70 dark:hover:bg-slate-900/50"
            >
              Add schedule
            </button>
          </div>
        </div>
      </section>

      <section className={glass}>
        <h2 className="mb-3 text-base font-semibold">Scheduled report list</h2>
        {schedules.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">No scheduled reports.</p>
        ) : (
          <div className="space-y-2">
            {schedules.map((entry) => {
              const template = templates.find((template) => template.id === entry.templateId);
              return (
                <div
                  key={entry.id}
                  className="flex flex-col gap-2 rounded-2xl border border-white/30 bg-white/45 p-3 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <p className="font-semibold">{template?.title ?? "Template"}</p>
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      {entry.frequency} at {entry.runTime} · {entry.runDay} · formats {entry.formats.join(", ")}
                    </p>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400">{formatDate(entry.createdAt)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeSchedule(entry.id)}
                    className="rounded-2xl border border-rose-300/40 bg-rose-600 px-3 py-2 text-xs text-white"
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className={glass}>
        <h2 className="mb-3 text-base font-semibold">Saved report history</h2>
        {history.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">No generated reports yet.</p>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full divide-y divide-white/30 text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-700 dark:text-slate-200">
                  <th className="px-3 py-2">Report</th>
                  <th className="px-3 py-2">Format</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry) => {
                  const template = templates.find((template) => template.id === entry.templateId);
                  return (
                    <tr key={entry.id} className="odd:bg-white/20 dark:odd:bg-slate-950/20">
                      <td className="px-3 py-2">
                        {template?.title ?? "Template"} • {entry.title}
                      </td>
                      <td className="px-3 py-2 uppercase">{entry.format}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] ${
                            entry.status === "generated"
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200"
                              : entry.status === "failed"
                                ? "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-200"
                                : "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-200"
                          }`}
                        >
                          {entry.status}
                        </span>
                      </td>
                      <td className="px-3 py-2">{formatDate(entry.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
