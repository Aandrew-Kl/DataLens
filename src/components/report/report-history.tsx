"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Download, FileClock, Filter, Trash2 } from "lucide-react";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import { REPORT_TEMPLATES, type ReportTemplateId } from "@/components/report/report-templates";

interface ReportHistoryEntry {
  id: string;
  reportName: string;
  templateId: ReportTemplateId;
  generatedAt: number;
  rowCount: number;
  mimeType: string;
  content: string;
}

type SortKey = "reportName" | "templateId" | "generatedAt" | "rowCount";
type SortDirection = "asc" | "desc";

const STORAGE_KEY = "datalens-report-history";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTemplateId(value: unknown): value is ReportTemplateId {
  return (
    typeof value === "string" &&
    REPORT_TEMPLATES.some((template) => template.id === value)
  );
}

function readHistory(): ReportHistoryEntry[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap<ReportHistoryEntry>((entry) => {
      if (!isRecord(entry) || !isTemplateId(entry.templateId)) {
        return [];
      }

      const generatedAt = Number(entry.generatedAt);
      const rowCount = Number(entry.rowCount);

      return [
        {
          id:
            typeof entry.id === "string"
              ? entry.id
              : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          reportName:
            typeof entry.reportName === "string" && entry.reportName.trim().length > 0
              ? entry.reportName
              : "Generated report",
          templateId: entry.templateId,
          generatedAt: Number.isFinite(generatedAt) ? generatedAt : Date.now(),
          rowCount: Number.isFinite(rowCount) ? Math.max(0, Math.round(rowCount)) : 0,
          mimeType:
            typeof entry.mimeType === "string" && entry.mimeType.trim().length > 0
              ? entry.mimeType
              : "text/markdown;charset=utf-8;",
          content:
            typeof entry.content === "string" && entry.content.trim().length > 0
              ? entry.content
              : "# Report\n\nNo content was saved for this entry.",
        },
      ];
    });
  } catch {
    return [];
  }
}

function persistHistory(history: ReportHistoryEntry[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

function templateLabel(templateId: ReportTemplateId) {
  return (
    REPORT_TEMPLATES.find((template) => template.id === templateId)?.name ??
    "Unknown template"
  );
}

function compareValues<T extends string | number>(left: T, right: T) {
  return typeof left === "string"
    ? left.localeCompare(String(right))
    : Number(left) - Number(right);
}

function buildReportFilename(entry: ReportHistoryEntry) {
  const slug = entry.reportName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "report"}-${new Date(entry.generatedAt).toISOString().slice(0, 10)}.md`;
}

export default function ReportHistory() {
  const [history, setHistory] = useState<ReportHistoryEntry[]>(() => readHistory());
  const [templateFilter, setTemplateFilter] = useState<ReportTemplateId | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey>("generatedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const visibleHistory = useMemo(() => {
    const filtered = templateFilter === "all"
      ? history
      : history.filter((entry) => entry.templateId === templateFilter);

    return [...filtered].sort((left, right) => {
      const leftValue = left[sortKey];
      const rightValue = right[sortKey];
      const result = compareValues(
        leftValue as string | number,
        rightValue as string | number,
      );
      return sortDirection === "asc" ? result : -result;
    });
  }, [history, sortDirection, sortKey, templateFilter]);

  function updateHistory(
    updater: (current: ReportHistoryEntry[]) => ReportHistoryEntry[],
  ) {
    setHistory((current) => {
      const next = updater(current);
      persistHistory(next);
      return next;
    });
  }

  function toggleSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextKey);
    setSortDirection(nextKey === "reportName" || nextKey === "templateId" ? "asc" : "desc");
  }

  function deleteEntry(id: string) {
    updateHistory((current) => current.filter((entry) => entry.id !== id));
  }

  function deleteOldReports() {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    updateHistory((current) => current.filter((entry) => entry.generatedAt >= cutoff));
  }

  function downloadEntry(entry: ReportHistoryEntry) {
    downloadFile(entry.content, buildReportFilename(entry), entry.mimeType);
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-sky-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-sky-700 dark:text-sky-300">
            <FileClock className="h-3.5 w-3.5" />
            Report history
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Review generated reports and keep the archive lean
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Sort by report metadata, filter by template family, redownload saved report content,
            or remove stale entries from local storage.
          </p>
        </div>

        <div className={`${GLASS_CARD_CLASS} flex items-center gap-3 p-4`}>
          <Filter className="h-5 w-5 text-sky-500" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Visible entries
            </p>
            <p className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">
              {visibleHistory.length}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-4 sm:flex-row">
          <label className="min-w-56">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Template filter
            </span>
            <select
              value={templateFilter}
              onChange={(event) =>
                setTemplateFilter(event.target.value as ReportTemplateId | "all")
              }
              className={FIELD_CLASS}
            >
              <option value="all">All templates</option>
              {REPORT_TEMPLATES.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button type="button" onClick={deleteOldReports} className={BUTTON_CLASS}>
          <Trash2 className="h-4 w-4" />
          Delete older than 30 days
        </button>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
        className={`${GLASS_CARD_CLASS} mt-6 overflow-hidden`}
      >
        {visibleHistory.length === 0 ? (
          <div className="p-8 text-sm text-slate-600 dark:text-slate-300">
            No generated reports are stored yet. Once reports are saved to localStorage, they will
            appear here with download, sort, and cleanup actions.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-white/55 dark:bg-slate-900/55">
                <tr>
                  {[
                    { key: "reportName", label: "Report" },
                    { key: "templateId", label: "Template" },
                    { key: "generatedAt", label: "Generated" },
                    { key: "rowCount", label: "Rows" },
                  ].map((column) => (
                    <th key={column.key} className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key as SortKey)}
                        className="font-semibold text-slate-700 transition hover:text-slate-950 dark:text-slate-200 dark:hover:text-white"
                      >
                        {column.label}
                      </button>
                    </th>
                  ))}
                  <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">
                    Download
                  </th>
                  <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">
                    Delete
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleHistory.map((entry) => (
                  <tr key={entry.id} className="border-t border-white/10">
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                      {entry.reportName}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {templateLabel(entry.templateId)}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {new Date(entry.generatedAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {formatNumber(entry.rowCount)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => downloadEntry(entry)}
                        className={`${BUTTON_CLASS} px-3 py-2`}
                      >
                        <Download className="h-4 w-4" />
                        Download
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => deleteEntry(entry.id)}
                        className={`${BUTTON_CLASS} px-3 py-2 text-rose-700 dark:text-rose-300`}
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
    </section>
  );
}
