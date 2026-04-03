"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Download, Eye, FileCode2, FileJson, FileSpreadsheet } from "lucide-react";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface ReportExportPanelProps {
  tableName: string;
  columns: ColumnProfile[];
}

type ExportFormat = "html" | "csv" | "json";

interface ReportSection {
  id: string;
  title: string;
  body: string;
}

interface SummaryCardProps {
  icon: typeof Eye;
  label: string;
  value: string;
}

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

function buildSections(tableName: string, columns: ColumnProfile[]): ReportSection[] {
  const numericColumns = columns.filter((column) => column.type === "number");
  const dateColumns = columns.filter((column) => column.type === "date");

  return [
    {
      id: "overview",
      title: "Overview",
      body: `Report for table "${tableName}" with ${columns.length} profiled columns.`,
    },
    {
      id: "schema",
      title: "Schema",
      body: columns
        .map((column) => `${column.name} (${column.type})`)
        .join(", "),
    },
    {
      id: "quality",
      title: "Data quality",
      body: columns
        .map((column) => `${column.name}: ${column.nullCount} nulls, ${column.uniqueCount} unique`)
        .join(" | "),
    },
    {
      id: "focus",
      title: "Focus areas",
      body: [
        numericColumns.length > 0
          ? `Numeric columns: ${numericColumns.map((column) => column.name).join(", ")}`
          : "Numeric columns: none",
        dateColumns.length > 0
          ? `Date columns: ${dateColumns.map((column) => column.name).join(", ")}`
          : "Date columns: none",
      ].join(" | "),
    },
  ];
}

function buildHtmlPreview(tableName: string, sections: ReportSection[]): string {
  const cards = sections
    .map(
      (section) => `
  <section>
    <h2>${section.title}</h2>
    <p>${section.body}</p>
  </section>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${tableName} report export</title>
  </head>
  <body>
    <h1>${tableName} report export</h1>
${cards}
  </body>
</html>`;
}

function buildCsvPreview(sections: ReportSection[]): string {
  const header = "section,content";
  const body = sections.map((section) => `"${section.title}","${section.body.replaceAll('"', '""')}"`);
  return [header, ...body].join("\n");
}

function buildJsonPreview(tableName: string, sections: ReportSection[]): string {
  return JSON.stringify(
    {
      tableName,
      generatedAt: new Date().toISOString(),
      sections,
    },
    null,
    2,
  );
}

function buildPreview(format: ExportFormat, tableName: string, sections: ReportSection[]): string {
  switch (format) {
    case "csv":
      return buildCsvPreview(sections);
    case "json":
      return buildJsonPreview(tableName, sections);
    default:
      return buildHtmlPreview(tableName, sections);
  }
}

function getMimeType(format: ExportFormat): string {
  switch (format) {
    case "csv":
      return "text/csv;charset=utf-8;";
    case "json":
      return "application/json;charset=utf-8;";
    default:
      return "text/html;charset=utf-8;";
  }
}

function getExtension(format: ExportFormat): string {
  switch (format) {
    case "csv":
      return "csv";
    case "json":
      return "json";
    default:
      return "html";
  }
}

export default function ReportExportPanel({ tableName, columns }: ReportExportPanelProps) {
  const sections = useMemo(() => buildSections(tableName, columns), [columns, tableName]);
  const [format, setFormat] = useState<ExportFormat>("html");
  const [includedSectionIds, setIncludedSectionIds] = useState<string[]>(() =>
    sections.map((section) => section.id),
  );

  const selectedSections = useMemo(
    () => sections.filter((section) => includedSectionIds.includes(section.id)),
    [includedSectionIds, sections],
  );

  const preview = useMemo(
    () => buildPreview(format, tableName, selectedSections),
    [format, selectedSections, tableName],
  );

  function toggleSection(sectionId: string) {
    setIncludedSectionIds((current) =>
      current.includes(sectionId)
        ? current.filter((value) => value !== sectionId)
        : [...current, sectionId],
    );
  }

  function handleDownload() {
    downloadFile(
      preview,
      `${tableName}-report-export.${getExtension(format)}`,
      getMimeType(format),
    );
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <FileCode2 className="h-3.5 w-3.5" />
            Report export
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Report export panel
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Choose the output format, include only the sections you need, and preview the exact file
            that will be downloaded.
          </p>
        </div>

        <button type="button" onClick={handleDownload} className={BUTTON_CLASS}>
          <Download className="h-4 w-4" />
          Download export
        </button>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <SummaryCard icon={FileCode2} label="Format" value={format.toUpperCase()} />
        <SummaryCard
          icon={Eye}
          label="Sections included"
          value={formatNumber(selectedSections.length)}
        />
        <SummaryCard icon={FileSpreadsheet} label="Columns profiled" value={formatNumber(columns.length)} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-4">
          <div className={`${GLASS_CARD_CLASS} p-4`}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Export format
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {([
                { value: "html", label: "HTML", icon: FileCode2 },
                { value: "csv", label: "CSV", icon: FileSpreadsheet },
                { value: "json", label: "JSON", icon: FileJson },
              ] as const).map((option) => {
                const active = format === option.value;
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setFormat(option.value)}
                    className={`rounded-3xl border px-4 py-4 text-left transition ${
                      active
                        ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200"
                        : "border-white/20 bg-white/60 text-slate-700 dark:border-white/10 dark:bg-slate-950/30 dark:text-slate-200"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    <div className="mt-3 text-sm font-semibold">{option.label}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className={`${GLASS_CARD_CLASS} p-4`}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Include sections
            </p>
            <div className="mt-4 space-y-3">
              {sections.map((section) => {
                const active = includedSectionIds.includes(section.id);
                return (
                  <label
                    key={section.id}
                    className="flex cursor-pointer items-start gap-3 rounded-3xl border border-white/15 bg-white/60 px-4 py-3 dark:bg-slate-950/25"
                  >
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => toggleSection(section.id)}
                      className="mt-1 h-4 w-4 rounded border-white/20"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-slate-900 dark:text-white">
                        {section.title}
                      </span>
                      <span className="mt-1 block text-xs text-slate-600 dark:text-slate-300">
                        {section.body}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
          className={`${GLASS_CARD_CLASS} overflow-hidden`}
        >
          <div className="border-b border-white/15 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-950 dark:text-white">Export preview</h3>
          </div>
          <pre
            aria-label="Export preview"
            className="max-h-[36rem] overflow-auto whitespace-pre-wrap px-5 py-4 text-sm leading-6 text-slate-700 dark:text-slate-200"
          >
            {preview}
          </pre>
        </motion.div>
      </div>
    </section>
  );
}
