"use client";

import { startTransition, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  Braces,
  Download,
  Eye,
  FileCode2,
  FileText,
  Loader2,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
  isRecord,
} from "@/lib/utils/advanced-analytics";
import type { ColumnProfile } from "@/types/dataset";

interface ReportNarrativeBuilderProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface NarrativeSection {
  id: string;
  title: string;
  template: string;
}

interface NarrativePreview {
  context: Record<string, string>;
  rendered: Array<{ id: string; title: string; body: string }>;
}

interface SectionEditorProps {
  section: NarrativeSection;
  isActive: boolean;
  isFirst: boolean;
  isLast: boolean;
  onSelect: (sectionId: string) => void;
  onTitleChange: (sectionId: string, value: string) => void;
  onTemplateChange: (sectionId: string, value: string) => void;
  onMoveUp: (sectionId: string) => void;
  onMoveDown: (sectionId: string) => void;
}

function createSectionId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildInitialSections(columns: ColumnProfile[]) {
  const firstToken = columns[0]?.name ?? "metric";
  const secondToken = columns[1]?.name ?? firstToken;
  const thirdToken = columns[2]?.name ?? secondToken;

  return [
    {
      id: createSectionId("summary"),
      title: "Executive summary",
      template: `{{${firstToken}}} anchors the headline trend while {{${secondToken}}} provides the main supporting signal.`,
    },
    {
      id: createSectionId("driver"),
      title: "Key driver",
      template: `The strongest movement in this report comes from {{${thirdToken}}}, which should be referenced alongside {{${firstToken}}}.`,
    },
    {
      id: createSectionId("action"),
      title: "Recommended action",
      template: `Use {{${firstToken}}} and {{${secondToken}}} as the primary callouts for the next review cycle.`,
    },
  ] as NarrativeSection[];
}

function SectionEditor({
  section,
  isActive,
  isFirst,
  isLast,
  onSelect,
  onTitleChange,
  onTemplateChange,
  onMoveUp,
  onMoveDown,
}: SectionEditorProps) {
  return (
    <div
      className={`${GLASS_CARD_CLASS} p-4 ${isActive ? "ring-2 ring-cyan-500/30" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => onSelect(section.id)}
          className="text-left"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Section
          </p>
          <p className="mt-1 text-base font-semibold text-slate-950 dark:text-white">
            {section.title}
          </p>
        </button>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onMoveUp(section.id)}
            className={BUTTON_CLASS}
            disabled={isFirst}
            aria-label={`Move ${section.title} up`}
          >
            <ArrowUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onMoveDown(section.id)}
            className={BUTTON_CLASS}
            disabled={isLast}
            aria-label={`Move ${section.title} down`}
          >
            <ArrowDown className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Section title
          </span>
          <input
            value={section.title}
            onChange={(event) => onTitleChange(section.id, event.target.value)}
            onFocus={() => onSelect(section.id)}
            className={FIELD_CLASS}
            aria-label={`${section.title} title`}
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Template
          </span>
          <textarea
            value={section.template}
            onChange={(event) => onTemplateChange(section.id, event.target.value)}
            onFocus={() => onSelect(section.id)}
            className={`${FIELD_CLASS} min-h-28 resize-none`}
            aria-label={`${section.title} template`}
          />
        </label>
      </div>
    </div>
  );
}

function buildPreviewQuery(tableName: string, columns: ColumnProfile[]) {
  const selectedColumns = columns.slice(0, 6);

  if (selectedColumns.length === 0) {
    return "";
  }

  return `
    SELECT
      ${selectedColumns
        .map(
          (column) =>
            `CAST(${quoteIdentifier(column.name)} AS VARCHAR) AS ${quoteIdentifier(column.name)}`,
        )
        .join(",\n      ")}
    FROM ${quoteIdentifier(tableName)}
    LIMIT 1
  `;
}

function buildFallbackContext(columns: ColumnProfile[]) {
  const entries = columns.map<[string, string]>((column) => [
    column.name,
    String(column.sampleValues[0] ?? "n/a"),
  ]);

  return Object.fromEntries(entries);
}

function buildPreviewContext(
  columns: ColumnProfile[],
  rows: Record<string, unknown>[],
): Record<string, string> {
  const fallback = buildFallbackContext(columns);
  const firstRow = rows[0];

  if (!firstRow || !isRecord(firstRow)) {
    return fallback;
  }

  const context: Record<string, string> = { ...fallback };
  for (const column of columns) {
    const value = firstRow[column.name];
    context[column.name] = value === undefined || value === null ? fallback[column.name] : String(value);
  }

  return context;
}

function renderTemplate(template: string, context: Record<string, string>) {
  return template.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (_, token: string) => context[token] ?? `{{${token}}}`);
}

function buildPreview(
  sections: NarrativeSection[],
  context: Record<string, string>,
): NarrativePreview {
  return {
    context,
    rendered: sections.map((section) => ({
      id: section.id,
      title: section.title,
      body: renderTemplate(section.template, context),
    })),
  };
}

function moveSection(sections: NarrativeSection[], sectionId: string, direction: -1 | 1) {
  const index = sections.findIndex((section) => section.id === sectionId);

  if (index < 0) return sections;

  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= sections.length) return sections;

  const next = [...sections];
  const [section] = next.splice(index, 1);
  next.splice(targetIndex, 0, section);
  return next;
}

function buildMarkdown(preview: NarrativePreview) {
  return preview.rendered
    .map((section) => `## ${section.title}\n\n${section.body}`)
    .join("\n\n");
}

function buildHtml(preview: NarrativePreview) {
  const sections = preview.rendered
    .map(
      (section) =>
        `<section><h2>${section.title}</h2><p>${section.body}</p></section>`,
    )
    .join("");

  return `<!doctype html><html><body>${sections}</body></html>`;
}

export default function ReportNarrativeBuilder({
  tableName,
  columns,
}: ReportNarrativeBuilderProps) {
  const [sections, setSections] = useState<NarrativeSection[]>(() => buildInitialSections(columns));
  const [activeSectionId, setActiveSectionId] = useState(sections[0]?.id ?? "");
  const [preview, setPreview] = useState<NarrativePreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState(
    "Insert data references like {{column_name}} and render a narrative preview.",
  );

  const activeSection = useMemo(
    () => sections.find((section) => section.id === activeSectionId) ?? sections[0] ?? null,
    [activeSectionId, sections],
  );

  async function handlePreview() {
    const query = buildPreviewQuery(tableName, columns);
    setIsLoading(true);

    try {
      const rows = query ? await runQuery(query) : [];
      const context = buildPreviewContext(columns, rows);
      const nextPreview = buildPreview(sections, context);

      startTransition(() => {
        setPreview(nextPreview);
        setStatus(`Rendered ${nextPreview.rendered.length} narrative sections.`);
      });
    } catch {
      setStatus("Narrative preview failed. Check the selected data references.");
    } finally {
      setIsLoading(false);
    }
  }

  function updateSection(sectionId: string, patch: Partial<Omit<NarrativeSection, "id">>) {
    setSections((current) =>
      current.map((section) =>
        section.id === sectionId ? { ...section, ...patch } : section,
      ),
    );
  }

  function handleInsertToken(token: string) {
    if (!activeSection) return;
    const nextTemplate = `${activeSection.template}${activeSection.template.endsWith(" ") ? "" : " "}{{${token}}}`;
    updateSection(activeSection.id, { template: nextTemplate });
    setStatus(`Inserted {{${token}}} into ${activeSection.title}.`);
  }

  function handleMove(sectionId: string, direction: -1 | 1) {
    setSections((current) => moveSection(current, sectionId, direction));
  }

  function handleExportMarkdown() {
    if (!preview) return;
    downloadFile(
      buildMarkdown(preview),
      `${tableName}-report-narrative.md`,
      "text/markdown;charset=utf-8;",
    );
  }

  function handleExportHtml() {
    if (!preview) return;
    downloadFile(
      buildHtml(preview),
      `${tableName}-report-narrative.html`,
      "text/html;charset=utf-8;",
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <FileText className="h-3.5 w-3.5" />
            Report narratives
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Build templated report narratives with live data references
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Arrange sections, inject column references, and render data-backed narrative copy for
            Markdown or HTML report exports.
          </p>
        </div>

        <div className={`${GLASS_CARD_CLASS} max-w-md p-4`}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Builder status
          </p>
          <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
            {activeSection?.title ?? "No active section"}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{status}</p>
        </div>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-slate-950 dark:text-white">
              Data references
            </h3>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Active: {activeSection?.title ?? "None"}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {columns.map((column) => (
              <button
                key={column.name}
                type="button"
                onClick={() => handleInsertToken(column.name)}
                className={BUTTON_CLASS}
              >
                <Braces className="h-4 w-4" />
                {`{{${column.name}}}`}
              </button>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handlePreview()}
              className={BUTTON_CLASS}
              disabled={isLoading}
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
              Preview narrative
            </button>
            <button
              type="button"
              onClick={handleExportMarkdown}
              className={BUTTON_CLASS}
              disabled={!preview}
            >
              <Download className="h-4 w-4" />
              Export Markdown
            </button>
            <button
              type="button"
              onClick={handleExportHtml}
              className={BUTTON_CLASS}
              disabled={!preview}
            >
              <FileCode2 className="h-4 w-4" />
              Export HTML
            </button>
          </div>
        </div>

        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <h3 className="text-base font-semibold text-slate-950 dark:text-white">
            Preview context
          </h3>
          {!preview ? (
            <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">
              The preview uses the first available row from DuckDB, then falls back to sampled
              column values if the query has no rows.
            </p>
          ) : (
            <div className="mt-4 space-y-2 text-sm text-slate-600 dark:text-slate-300">
              {Object.entries(preview.context).slice(0, 6).map(([key, value]) => (
                <p key={key}>
                  <span className="font-medium text-slate-950 dark:text-white">{key}:</span> {value}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="grid gap-4">
          {sections.map((section, index) => (
            <SectionEditor
              key={section.id}
              section={section}
              isActive={section.id === activeSection?.id}
              isFirst={index === 0}
              isLast={index === sections.length - 1}
              onSelect={setActiveSectionId}
              onTitleChange={(sectionId, value) => updateSection(sectionId, { title: value })}
              onTemplateChange={(sectionId, value) => updateSection(sectionId, { template: value })}
              onMoveUp={(sectionId) => handleMove(sectionId, -1)}
              onMoveDown={(sectionId) => handleMove(sectionId, 1)}
            />
          ))}
        </div>

        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <h3 className="text-base font-semibold text-slate-950 dark:text-white">
            Rendered preview
          </h3>
          {!preview ? (
            <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">
              Render a preview to inspect section ordering and token substitution before exporting.
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              {preview.rendered.map((section) => (
                <article key={section.id} className={`${GLASS_CARD_CLASS} p-4`}>
                  <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    {section.title}
                  </h4>
                  <p className="mt-3 text-sm leading-6 text-slate-700 dark:text-slate-200">
                    {section.body}
                  </p>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.section>
  );
}
