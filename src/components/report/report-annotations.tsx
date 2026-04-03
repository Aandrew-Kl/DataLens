"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Edit3, FileText, MessageSquarePlus, Trash2 } from "lucide-react";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  isRecord,
} from "@/lib/utils/advanced-analytics";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface ReportAnnotationsProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface ReportAnnotation {
  id: string;
  sectionId: string;
  sectionLabel: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

type SortOrder = "newest" | "oldest";

interface SummaryCardProps {
  icon: typeof FileText;
  label: string;
  value: string;
}

const STORAGE_PREFIX = "datalens-report-annotations";

function SummaryCard({ icon: Icon, label, value }: SummaryCardProps) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-cyan-500/10 p-3 text-cyan-600 dark:text-cyan-300">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            {label}
          </p>
          <p className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">{value}</p>
        </div>
      </div>
    </div>
  );
}

function storageKey(tableName: string): string {
  return `${STORAGE_PREFIX}:${tableName}`;
}

function buildSections(tableName: string, columns: ColumnProfile[]): Array<{ id: string; label: string }> {
  return [
    { id: "overview", label: `${tableName} overview` },
    ...columns.slice(0, 6).map((column) => ({
      id: column.name,
      label: column.name,
    })),
  ];
}

function createAnnotationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readAnnotations(key: string): ReportAnnotation[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap<ReportAnnotation>((value) => {
      if (!isRecord(value)) {
        return [];
      }

      const createdAt = Number(value.createdAt);
      const updatedAt = Number(value.updatedAt);

      if (
        typeof value.id !== "string" ||
        typeof value.sectionId !== "string" ||
        typeof value.sectionLabel !== "string" ||
        typeof value.content !== "string" ||
        !Number.isFinite(createdAt) ||
        !Number.isFinite(updatedAt)
      ) {
        return [];
      }

      return [
        {
          id: value.id,
          sectionId: value.sectionId,
          sectionLabel: value.sectionLabel,
          content: value.content,
          createdAt,
          updatedAt,
        },
      ];
    });
  } catch {
    return [];
  }
}

function persistAnnotations(key: string, annotations: ReportAnnotation[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(annotations));
}

function formatTimestamp(value: number): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ReportAnnotations({ tableName, columns }: ReportAnnotationsProps) {
  const sections = useMemo(() => buildSections(tableName, columns), [columns, tableName]);
  const key = storageKey(tableName);
  const [annotations, setAnnotations] = useState<ReportAnnotation[]>(() => readAnnotations(key));
  const [selectedSectionId, setSelectedSectionId] = useState(sections[0]?.id ?? "");
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");

  const visibleAnnotations = useMemo(
    () =>
      [...annotations].sort((left, right) =>
        sortOrder === "newest"
          ? right.updatedAt - left.updatedAt
          : left.updatedAt - right.updatedAt,
      ),
    [annotations, sortOrder],
  );

  function commit(nextAnnotations: ReportAnnotation[]) {
    setAnnotations(nextAnnotations);
    persistAnnotations(key, nextAnnotations);
  }

  function resetForm() {
    setDraft("");
    setEditingId(null);
    setSelectedSectionId(sections[0]?.id ?? "");
  }

  function handleSubmit() {
    const trimmedDraft = draft.trim();
    const section = sections.find((entry) => entry.id === selectedSectionId);

    if (!trimmedDraft || !section) {
      return;
    }

    if (editingId) {
      commit(
        annotations.map((annotation) =>
          annotation.id === editingId
            ? {
                ...annotation,
                sectionId: section.id,
                sectionLabel: section.label,
                content: trimmedDraft,
                updatedAt: Date.now(),
              }
            : annotation,
        ),
      );
      resetForm();
      return;
    }

    const timestamp = Date.now();
    commit([
      {
        id: createAnnotationId(),
        sectionId: section.id,
        sectionLabel: section.label,
        content: trimmedDraft,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      ...annotations,
    ]);
    resetForm();
  }

  function handleEdit(annotation: ReportAnnotation) {
    setEditingId(annotation.id);
    setSelectedSectionId(annotation.sectionId);
    setDraft(annotation.content);
  }

  function handleDelete(annotationId: string) {
    commit(annotations.filter((annotation) => annotation.id !== annotationId));
    if (editingId === annotationId) {
      resetForm();
    }
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <MessageSquarePlus className="h-3.5 w-3.5" />
            Report annotations
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Report annotations
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Capture notes by report section, keep a timestamped audit trail, and update or remove
            entries from local storage as the report evolves.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <SummaryCard icon={MessageSquarePlus} label="Annotations" value={formatNumber(annotations.length)} />
        <SummaryCard icon={FileText} label="Sections" value={formatNumber(sections.length)} />
        <SummaryCard
          icon={Edit3}
          label="Mode"
          value={editingId ? "Editing" : "Creating"}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-4">
          <div className={`${GLASS_CARD_CLASS} p-4`}>
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Report section
              </span>
              <select
                aria-label="Report section"
                value={selectedSectionId}
                onChange={(event) => setSelectedSectionId(event.target.value)}
                className={FIELD_CLASS}
              >
                {sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-4 block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Annotation note
              </span>
              <textarea
                aria-label="Annotation note"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={7}
                className={`${FIELD_CLASS} min-h-[11rem] resize-y`}
              />
            </label>

            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" onClick={handleSubmit} className={BUTTON_CLASS}>
                <MessageSquarePlus className="h-4 w-4" />
                {editingId ? "Save annotation" : "Add annotation"}
              </button>
              {editingId ? (
                <button type="button" onClick={resetForm} className={BUTTON_CLASS}>
                  Cancel edit
                </button>
              ) : null}
            </div>
          </div>

          <div className={`${GLASS_CARD_CLASS} p-4`}>
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Sort order
              </span>
              <select
                aria-label="Sort order"
                value={sortOrder}
                onChange={(event) => setSortOrder(event.target.value as SortOrder)}
                className={FIELD_CLASS}
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </label>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
          className={`${GLASS_CARD_CLASS} overflow-hidden`}
        >
          <div className="border-b border-white/15 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-950 dark:text-white">Saved notes</h3>
          </div>

          {visibleAnnotations.length === 0 ? (
            <div className="p-6 text-sm text-slate-600 dark:text-slate-300">
              No annotations stored yet. Add a section note to start building the report narrative.
            </div>
          ) : (
            <div className="space-y-4 p-5">
              {visibleAnnotations.map((annotation) => (
                <article
                  key={annotation.id}
                  className="rounded-3xl border border-white/15 bg-white/60 p-4 dark:bg-slate-950/25"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-950 dark:text-white">
                        {annotation.sectionLabel}
                      </div>
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {formatTimestamp(annotation.updatedAt)}
                        {annotation.updatedAt !== annotation.createdAt ? " · edited" : ""}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleEdit(annotation)}
                        className={BUTTON_CLASS}
                      >
                        <Edit3 className="h-4 w-4" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(annotation.id)}
                        className={BUTTON_CLASS}
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </button>
                    </div>
                  </div>

                  <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-200">
                    {annotation.content}
                  </p>
                </article>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </section>
  );
}
