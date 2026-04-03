"use client";

import { startTransition, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  FileText,
  LayoutTemplate,
  Plus,
  Rows4,
  Trash2,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

interface ReportDesignerProps {
  tableName: string;
  columns: ColumnProfile[];
}

type ReportSectionType = "title" | "chart" | "table" | "narrative";

interface TitleSection {
  id: string;
  type: "title";
  eyebrow: string;
  heading: string;
}

interface ChartSection {
  id: string;
  type: "chart";
  title: string;
  dimension: string;
  metric: string;
}

interface TableSection {
  id: string;
  type: "table";
  title: string;
  visibleColumns: string[];
  limit: number;
}

interface NarrativeSection {
  id: string;
  type: "narrative";
  title: string;
  content: string;
}

type ReportSection = TitleSection | ChartSection | TableSection | NarrativeSection;
type SectionPatch =
  | Partial<TitleSection>
  | Partial<ChartSection>
  | Partial<TableSection>
  | Partial<NarrativeSection>;

interface ChartPreviewPoint {
  label: string;
  value: number;
}

type PreviewPayload =
  | { kind: "chart"; points: ChartPreviewPoint[] }
  | { kind: "table"; headers: string[]; rows: Record<string, unknown>[] };

const SECTION_TYPES = ["title", "chart", "table", "narrative"] as const;

function createSectionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `section-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getDefaultDimension(columns: ColumnProfile[]) {
  return (
    columns.find(
      (column) => column.type === "string" || column.type === "date",
    )?.name ??
    columns[0]?.name ??
    ""
  );
}

function getDefaultMetric(columns: ColumnProfile[]) {
  return columns.find((column) => column.type === "number")?.name ?? "";
}

function createSection(
  type: ReportSectionType,
  tableName: string,
  columns: ColumnProfile[],
): ReportSection {
  const dimension = getDefaultDimension(columns);
  const metric = getDefaultMetric(columns);

  switch (type) {
    case "title":
      return {
        id: createSectionId(),
        type: "title",
        eyebrow: "Executive summary",
        heading: `${tableName} performance snapshot`,
      };
    case "chart":
      return {
        id: createSectionId(),
        type: "chart",
        title: `${metric || "Metric"} by ${dimension || "dimension"}`,
        dimension,
        metric,
      };
    case "table":
      return {
        id: createSectionId(),
        type: "table",
        title: `${tableName} detail table`,
        visibleColumns: columns.slice(0, 4).map((column) => column.name),
        limit: 8,
      };
    case "narrative":
      return {
        id: createSectionId(),
        type: "narrative",
        title: "Analyst note",
        content:
          "Summarize the trend, explain the key drivers, and note any caveats that should shape the recommendation.",
      };
  }
}

function patchSection(section: ReportSection, patch: SectionPatch): ReportSection {
  return { ...section, ...patch } as ReportSection;
}

function reorderSections(
  sections: ReportSection[],
  sourceId: string,
  targetId: string,
) {
  const sourceIndex = sections.findIndex((section) => section.id === sourceId);
  const targetIndex = sections.findIndex((section) => section.id === targetId);

  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return sections;
  }

  const nextSections = [...sections];
  const [movedSection] = nextSections.splice(sourceIndex, 1);

  if (!movedSection) {
    return sections;
  }

  nextSections.splice(targetIndex, 0, movedSection);
  return nextSections;
}

function moveSection(
  sections: ReportSection[],
  sectionId: string,
  direction: -1 | 1,
) {
  const index = sections.findIndex((section) => section.id === sectionId);
  const targetIndex = index + direction;

  if (index < 0 || targetIndex < 0 || targetIndex >= sections.length) {
    return sections;
  }

  const nextSections = [...sections];
  [nextSections[index], nextSections[targetIndex]] = [
    nextSections[targetIndex]!,
    nextSections[index]!,
  ];
  return nextSections;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildChartQuery(tableName: string, section: ChartSection) {
  return `
    SELECT
      CAST(${quoteIdentifier(section.dimension)} AS VARCHAR) AS label,
      AVG(TRY_CAST(${quoteIdentifier(section.metric)} AS DOUBLE)) AS value
    FROM ${quoteIdentifier(tableName)}
    WHERE ${quoteIdentifier(section.dimension)} IS NOT NULL
      AND TRY_CAST(${quoteIdentifier(section.metric)} AS DOUBLE) IS NOT NULL
    GROUP BY 1
    ORDER BY value DESC
    LIMIT 6
  `;
}

function buildTableQuery(tableName: string, section: TableSection) {
  const safeColumns = section.visibleColumns
    .map((column) => quoteIdentifier(column))
    .join(", ");

  return `
    SELECT ${safeColumns}
    FROM ${quoteIdentifier(tableName)}
    LIMIT ${Math.max(section.limit, 1)}
  `;
}

function readChartPoints(rows: Record<string, unknown>[]) {
  return rows.flatMap((row) => {
    const label =
      typeof row.label === "string" && row.label.trim().length > 0
        ? row.label
        : String(row.label ?? "");
    const value = toNumber(row.value);

    if (!label || value === null) {
      return [];
    }

    return [{ label, value }];
  });
}

function buildExportHtml(
  tableName: string,
  sections: ReportSection[],
  previewData: Record<string, PreviewPayload>,
) {
  const body = sections
    .map((section) => {
      if (section.type === "title") {
        return `
          <section class="card hero">
            <p class="eyebrow">${escapeHtml(section.eyebrow)}</p>
            <h1>${escapeHtml(section.heading)}</h1>
          </section>
        `;
      }

      if (section.type === "narrative") {
        return `
          <section class="card">
            <h2>${escapeHtml(section.title)}</h2>
            <p>${escapeHtml(section.content)}</p>
          </section>
        `;
      }

      if (section.type === "chart") {
        const preview = previewData[section.id];
        const chartData: ChartPreviewPoint[] =
          preview?.kind === "chart" ? preview.points : [];
        const maxValue = Math.max(...chartData.map((point) => point.value), 1);

        return `
          <section class="card">
            <h2>${escapeHtml(section.title)}</h2>
            <div class="bars">
              ${chartData
                .map(
                  (point) => `
                    <div class="bar-row">
                      <span>${escapeHtml(point.label)}</span>
                      <div class="bar-track">
                        <div class="bar-fill" style="width:${(point.value / maxValue) * 100}%"></div>
                      </div>
                      <strong>${escapeHtml(point.value.toFixed(2))}</strong>
                    </div>
                  `,
                )
                .join("")}
            </div>
          </section>
        `;
      }

      const preview = previewData[section.id];
      const tableData:
        | { headers: string[]; rows: Record<string, unknown>[] }
        | { headers: string[]; rows: never[] } =
        preview?.kind === "table"
          ? { headers: preview.headers, rows: preview.rows }
          : { headers: section.visibleColumns, rows: [] };

      return `
        <section class="card">
          <h2>${escapeHtml(section.title)}</h2>
          <table>
            <thead>
              <tr>${tableData.headers
                .map((header) => `<th>${escapeHtml(header)}</th>`)
                .join("")}</tr>
            </thead>
            <tbody>
              ${tableData.rows
                .map(
                  (row) => `
                    <tr>${tableData.headers
                      .map(
                        (header) =>
                          `<td>${escapeHtml(String(row[header] ?? "—"))}</td>`,
                      )
                      .join("")}</tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>
        </section>
      `;
    })
    .join("");

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(tableName)} report</title>
        <style>
          body { font-family: "Segoe UI", sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 40px; }
          .card { background: rgba(255,255,255,0.88); border: 1px solid rgba(148,163,184,0.25); border-radius: 28px; padding: 28px; margin-bottom: 20px; box-shadow: 0 24px 48px rgba(15,23,42,0.08); }
          .hero { background: linear-gradient(135deg, rgba(34,211,238,0.14), rgba(168,85,247,0.12)); }
          .eyebrow { text-transform: uppercase; letter-spacing: 0.18em; font-size: 12px; color: #475569; }
          h1,h2 { margin: 0 0 16px; }
          p { line-height: 1.7; margin: 0; }
          .bars { display: grid; gap: 12px; }
          .bar-row { display: grid; grid-template-columns: 1.3fr 2fr auto; gap: 12px; align-items: center; }
          .bar-track { background: #e2e8f0; border-radius: 999px; overflow: hidden; height: 12px; }
          .bar-fill { background: linear-gradient(90deg, #06b6d4, #8b5cf6); height: 100%; border-radius: 999px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { text-align: left; padding: 12px 10px; border-top: 1px solid rgba(148,163,184,0.2); }
          th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.16em; color: #475569; }
        </style>
      </head>
      <body>${body}</body>
    </html>
  `;
}

function SectionEditorCard({
  section,
  columns,
  onPatch,
  onRemove,
  onMove,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  section: ReportSection;
  columns: ColumnProfile[];
  onPatch: (sectionId: string, patch: SectionPatch) => void;
  onRemove: (sectionId: string) => void;
  onMove: (sectionId: string, direction: -1 | 1) => void;
  onDragStart: (sectionId: string) => void;
  onDragOver: () => void;
  onDrop: (sectionId: string) => void;
}) {
  return (
    <article
      data-testid="section-card"
      className={`${GLASS_CARD_CLASS} space-y-4 p-5`}
      draggable
      onDragStart={() => onDragStart(section.id)}
      onDragOver={(event) => {
        event.preventDefault();
        onDragOver();
      }}
      onDrop={() => onDrop(section.id)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <span className="rounded-full border border-white/15 bg-white/50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 dark:bg-slate-950/25 dark:text-slate-300">
            {section.type}
          </span>
          <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
            {section.type === "title"
              ? section.heading
              : section.type === "chart"
                ? section.title
                : section.type === "table"
                  ? section.title
                  : section.title}
          </h3>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className={BUTTON_CLASS}
            aria-label="Move section up"
            onClick={() => onMove(section.id, -1)}
          >
            <ArrowUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={BUTTON_CLASS}
            aria-label="Move section down"
            onClick={() => onMove(section.id, 1)}
          >
            <ArrowDown className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={BUTTON_CLASS}
            aria-label="Remove section"
            onClick={() => onRemove(section.id)}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {section.type === "title" ? (
        <div className="grid gap-3">
          <input
            className={FIELD_CLASS}
            value={section.eyebrow}
            onChange={(event) =>
              onPatch(section.id, { eyebrow: event.currentTarget.value })
            }
            placeholder="Eyebrow"
          />
          <input
            className={FIELD_CLASS}
            value={section.heading}
            onChange={(event) =>
              onPatch(section.id, { heading: event.currentTarget.value })
            }
            placeholder="Heading"
          />
        </div>
      ) : null}

      {section.type === "chart" ? (
        <div className="grid gap-3 md:grid-cols-3">
          <input
            className={FIELD_CLASS}
            value={section.title}
            onChange={(event) =>
              onPatch(section.id, { title: event.currentTarget.value })
            }
            placeholder="Chart title"
          />
          <select
            className={FIELD_CLASS}
            value={section.dimension}
            onChange={(event) =>
              onPatch(section.id, { dimension: event.currentTarget.value })
            }
          >
            {columns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
          <select
            className={FIELD_CLASS}
            value={section.metric}
            onChange={(event) =>
              onPatch(section.id, { metric: event.currentTarget.value })
            }
          >
            {columns
              .filter((column) => column.type === "number")
              .map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
          </select>
        </div>
      ) : null}

      {section.type === "table" ? (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_7rem]">
            <input
              className={FIELD_CLASS}
              value={section.title}
              onChange={(event) =>
                onPatch(section.id, { title: event.currentTarget.value })
              }
              placeholder="Table title"
            />
            <input
              className={FIELD_CLASS}
              type="number"
              min={1}
              max={25}
              value={section.limit}
              onChange={(event) =>
                onPatch(section.id, {
                  limit: Math.max(1, Number(event.currentTarget.value) || 1),
                })
              }
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {columns.map((column) => {
              const selected = section.visibleColumns.includes(column.name);
              const nextVisibleColumns = selected
                ? section.visibleColumns.filter((entry) => entry !== column.name)
                : [...section.visibleColumns, column.name];

              return (
                <button
                  key={column.name}
                  type="button"
                  className={`${BUTTON_CLASS} ${selected ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200" : ""}`}
                  onClick={() =>
                    onPatch(section.id, {
                      visibleColumns:
                        nextVisibleColumns.length > 0
                          ? nextVisibleColumns
                          : section.visibleColumns,
                    })
                  }
                >
                  {column.name}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {section.type === "narrative" ? (
        <div className="space-y-3">
          <input
            className={FIELD_CLASS}
            value={section.title}
            onChange={(event) =>
              onPatch(section.id, { title: event.currentTarget.value })
            }
            placeholder="Narrative title"
          />
          <textarea
            className={`${FIELD_CLASS} min-h-[10rem] resize-none`}
            value={section.content}
            onChange={(event) =>
              onPatch(section.id, { content: event.currentTarget.value })
            }
            placeholder="Narrative content"
          />
        </div>
      ) : null}
    </article>
  );
}

function SectionPreviewCard({
  section,
  preview,
}: {
  section: ReportSection;
  preview?: PreviewPayload;
}) {
  if (section.type === "title") {
    return (
      <article className={`${GLASS_CARD_CLASS} space-y-3 p-6`}>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
          {section.eyebrow}
        </p>
        <h3 className="text-3xl font-semibold text-slate-950 dark:text-white">
          {section.heading}
        </h3>
      </article>
    );
  }

  if (section.type === "narrative") {
    return (
      <article className={`${GLASS_CARD_CLASS} space-y-3 p-6`}>
        <h3 className="text-xl font-semibold text-slate-950 dark:text-white">
          {section.title}
        </h3>
        <p className="whitespace-pre-wrap text-sm leading-7 text-slate-600 dark:text-slate-300">
          {section.content}
        </p>
      </article>
    );
  }

  if (section.type === "chart") {
    const points = preview?.kind === "chart" ? preview.points : [];
    const maxValue = Math.max(...points.map((point) => point.value), 1);

    return (
      <article className={`${GLASS_CARD_CLASS} space-y-4 p-6`}>
        <div>
          <h3 className="text-xl font-semibold text-slate-950 dark:text-white">
            {section.title}
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {section.metric} grouped by {section.dimension}
          </p>
        </div>
        <div className="space-y-3">
          {points.length > 0 ? (
            points.map((point) => (
              <div
                key={`${section.id}-${point.label}`}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] items-center gap-3"
              >
                <span className="truncate text-sm text-slate-600 dark:text-slate-300">
                  {point.label}
                </span>
                <div className="h-3 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-violet-500"
                    style={{ width: `${(point.value / maxValue) * 100}%` }}
                  />
                </div>
                <strong className="text-sm text-slate-900 dark:text-slate-100">
                  {point.value.toFixed(2)}
                </strong>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No chart preview data available yet.
            </p>
          )}
        </div>
      </article>
    );
  }

  const tablePreview =
    preview?.kind === "table"
      ? preview
      : { headers: section.visibleColumns, rows: [] };

  return (
    <article className={`${GLASS_CARD_CLASS} space-y-4 p-6`}>
      <div>
        <h3 className="text-xl font-semibold text-slate-950 dark:text-white">
          {section.title}
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Showing up to {section.limit} rows
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
            <tr>
              {tablePreview.headers.map((header) => (
                <th key={`${section.id}-${header}`} className="pb-3 pr-4">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tablePreview.rows.map((row, rowIndex) => (
              <tr key={`${section.id}-row-${rowIndex}`} className="border-t border-white/10">
                {tablePreview.headers.map((header) => (
                  <td key={`${section.id}-${header}-${rowIndex}`} className="py-3 pr-4 text-slate-600 dark:text-slate-300">
                    {String(row[header] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

export default function ReportDesigner({
  tableName,
  columns,
}: ReportDesignerProps) {
  const [sections, setSections] = useState<ReportSection[]>([]);
  const [previewMode, setPreviewMode] = useState(false);
  const [previewData, setPreviewData] = useState<Record<string, PreviewPayload>>(
    {},
  );
  const [draggedSectionId, setDraggedSectionId] = useState<string | null>(null);
  const [status, setStatus] = useState(
    "Add sections, arrange them, and refresh the preview when the layout is ready.",
  );
  const [loadingPreview, setLoadingPreview] = useState(false);

  const canPreview = sections.length > 0;
  const canExport = sections.length > 0;
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );

  function handleAddSection(type: ReportSectionType) {
    if (type === "chart" && numericColumns.length === 0) {
      setStatus("Add a numeric column to the dataset before inserting a chart section.");
      return;
    }

    const nextSection = createSection(type, tableName, columns);
    setSections((current) => [...current, nextSection]);
    setStatus(`${type} section added.`);
  }

  function handlePatchSection(sectionId: string, patch: SectionPatch) {
    setSections((current) =>
      current.map((section) =>
        section.id === sectionId ? patchSection(section, patch) : section,
      ),
    );
  }

  function handleRemoveSection(sectionId: string) {
    setSections((current) =>
      current.filter((section) => section.id !== sectionId),
    );
    setStatus("Section removed.");
  }

  function handleMoveSection(sectionId: string, direction: -1 | 1) {
    setSections((current) => moveSection(current, sectionId, direction));
  }

  function handleDropSection(targetId: string) {
    if (!draggedSectionId) {
      return;
    }

    setSections((current) => reorderSections(current, draggedSectionId, targetId));
    setDraggedSectionId(null);
    setStatus("Section order updated.");
  }

  async function handleTogglePreview() {
    if (!canPreview) {
      return;
    }

    if (previewMode) {
      setPreviewMode(false);
      setStatus("Designer mode restored.");
      return;
    }

    setLoadingPreview(true);
    setStatus("Loading preview data from DuckDB…");

    try {
      const previewEntries = await Promise.all(
        sections.map(async (section) => {
          if (section.type === "chart") {
            const rows = await runQuery(buildChartQuery(tableName, section));
            return [
              section.id,
              { kind: "chart", points: readChartPoints(rows) } satisfies PreviewPayload,
            ] as const;
          }

          if (section.type === "table") {
            const rows = await runQuery(buildTableQuery(tableName, section));
            return [
              section.id,
              {
                kind: "table",
                headers: section.visibleColumns,
                rows,
              } satisfies PreviewPayload,
            ] as const;
          }

          return [section.id, undefined] as const;
        }),
      );

      const nextPreviewData = previewEntries.reduce<Record<string, PreviewPayload>>(
        (accumulator, [sectionId, payload]) => {
          if (payload) {
            accumulator[sectionId] = payload;
          }
          return accumulator;
        },
        {},
      );

      startTransition(() => {
        setPreviewData(nextPreviewData);
        setPreviewMode(true);
        setStatus("Preview refreshed from DuckDB.");
      });
    } catch (caughtError) {
      setStatus(
        caughtError instanceof Error
          ? caughtError.message
          : "Preview generation failed.",
      );
    } finally {
      setLoadingPreview(false);
    }
  }

  function handleExportHtml() {
    if (!canExport) {
      return;
    }

    const html = buildExportHtml(tableName, sections, previewData);
    downloadFile(
      [html],
      `${tableName}-report-designer.html`,
      "text/html;charset=utf-8;",
    );
    setStatus("Standalone HTML report exported.");
  }

  return (
    <motion.section
      className={`${GLASS_PANEL_CLASS} space-y-6 p-6`}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.38, ease: ANALYTICS_EASE }}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-indigo-500/10 p-3 text-indigo-600 dark:text-indigo-300">
              <LayoutTemplate className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
                Report designer
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Assemble title, chart, table, and narrative blocks into a browser-ready briefing.
              </p>
            </div>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-300">{status}</p>
        </div>

        <div className="flex flex-wrap gap-3">
          {SECTION_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              className={BUTTON_CLASS}
              onClick={() => handleAddSection(type)}
            >
              <Plus className="h-4 w-4" />
              Add {type}
            </button>
          ))}
          <button
            type="button"
            className={BUTTON_CLASS}
            onClick={() => void handleTogglePreview()}
            disabled={!canPreview || loadingPreview}
          >
            <Eye className="h-4 w-4" />
            {previewMode ? "Back to designer" : "Preview"}
          </button>
          <button
            type="button"
            className={BUTTON_CLASS}
            onClick={handleExportHtml}
            disabled={!canExport}
          >
            <FileText className="h-4 w-4" />
            Export HTML
          </button>
        </div>
      </div>

      {!previewMode ? (
        <div className="grid gap-4">
          {sections.length > 0 ? (
            sections.map((section) => (
              <SectionEditorCard
                key={section.id}
                section={section}
                columns={columns}
                onPatch={handlePatchSection}
                onRemove={handleRemoveSection}
                onMove={handleMoveSection}
                onDragStart={setDraggedSectionId}
                onDragOver={() => undefined}
                onDrop={handleDropSection}
              />
            ))
          ) : (
            <div className={`${GLASS_CARD_CLASS} flex min-h-[16rem] flex-col items-center justify-center gap-3 p-8 text-center`}>
              <Rows4 className="h-10 w-10 text-slate-400" />
              <div>
                <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
                  Start a layout
                </h3>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  Add a title, chart, table, or narrative section to begin the report flow.
                </p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-4">
          {sections.map((section) => (
            <SectionPreviewCard
              key={section.id}
              section={section}
              preview={previewData[section.id]}
            />
          ))}
        </div>
      )}
    </motion.section>
  );
}
