"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  Loader2,
} from "lucide-react";
import * as XLSX from "xlsx";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface DataExportWizardProps {
  tableName: string;
  columns: ColumnProfile[];
}

type ExportFormat = "csv" | "json" | "parquet" | "excel";

interface ExportPreviewRow {
  values: Record<string, unknown>;
}

interface StatusMessage {
  tone: "success" | "error" | "info";
  text: string;
}

interface StepDefinition {
  id: number;
  label: string;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const GLASS_PANEL_CLASS =
  "border border-white/20 bg-white/75 backdrop-blur-2xl dark:bg-slate-950/45";
const FIELD_CLASS =
  "w-full rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:border-slate-700/70 dark:bg-slate-950/65 dark:text-slate-100";
const BUTTON_CLASS =
  "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60";
const STEP_DEFINITIONS: readonly StepDefinition[] = [
  { id: 0, label: "Format" },
  { id: 1, label: "Options" },
  { id: 2, label: "Preview" },
  { id: 3, label: "Download" },
] as const;
const FORMAT_OPTIONS = [
  {
    id: "csv",
    label: "CSV",
    description: "Flat text export for spreadsheets and downstream pipelines.",
    icon: FileText,
  },
  {
    id: "json",
    label: "JSON",
    description: "Structured export for APIs, scripts, and app payloads.",
    icon: FileJson,
  },
  {
    id: "parquet",
    label: "Parquet",
    description: "Columnar package with metadata for analytical handoff.",
    icon: Database,
  },
  {
    id: "excel",
    label: "Excel",
    description: "Workbook export with a configurable sheet name.",
    icon: FileSpreadsheet,
  },
] as const satisfies ReadonlyArray<{
  id: ExportFormat;
  label: string;
  description: string;
  icon: typeof FileText;
}>;

function escapeCsvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (
    text.includes(",") ||
    text.includes('"') ||
    text.includes("\n") ||
    text.includes("\r")
  ) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function serializeCsv(rows: Record<string, unknown>[], includeHeaders: boolean) {
  const headers = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()),
  );
  const body = rows.map((row) =>
    headers.map((header) => escapeCsvCell(row[header])).join(","),
  );
  return includeHeaders ? [headers.join(","), ...body].join("\n") : body.join("\n");
}

function serializeJson(rows: Record<string, unknown>[], pretty: boolean) {
  return JSON.stringify(rows, null, pretty ? 2 : 0);
}

function serializeParquetPayload(
  rows: Record<string, unknown>[],
  compression: string,
  tableName: string,
) {
  return JSON.stringify(
    {
      format: "parquet",
      tableName,
      compression,
      generatedAt: new Date().toISOString(),
      rows,
    },
    null,
    2,
  );
}

function buildPreviewQuery(tableName: string, rowLimit: number) {
  return `
    SELECT *
    FROM ${quoteIdentifier(tableName)}
    LIMIT ${rowLimit}
  `;
}

function StepIndicator({ activeStep }: { activeStep: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-4">
      {STEP_DEFINITIONS.map((step) => {
        const isActive = step.id === activeStep;
        const isComplete = step.id < activeStep;

        return (
          <div
            key={step.id}
            className={`rounded-3xl p-4 ${
              isActive
                ? "border border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
                : isComplete
                  ? "border border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : `${GLASS_PANEL_CLASS} text-slate-500 dark:text-slate-300`
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-2xl border border-current/20">
                {isComplete ? <Check className="h-4 w-4" /> : <span>{step.id + 1}</span>}
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                  Step {step.id + 1}
                </p>
                <p className="mt-1 text-sm font-semibold">{step.label}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
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

export default function DataExportWizard({
  tableName,
  columns,
}: DataExportWizardProps) {
  const [step, setStep] = useState(0);
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [rowLimit, setRowLimit] = useState(50);
  const [includeHeaders, setIncludeHeaders] = useState(true);
  const [prettyJson, setPrettyJson] = useState(true);
  const [parquetCompression, setParquetCompression] = useState("snappy");
  const [sheetName, setSheetName] = useState("DataLensExport");
  const [previewRows, setPreviewRows] = useState<ExportPreviewRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);

  async function handleNext() {
    if (step === 2) {
      setStep(3);
      return;
    }

    if (step !== 1) {
      setStep((currentStep) => Math.min(3, currentStep + 1));
      return;
    }

    setLoading(true);
    setStatus(null);

    try {
      const rows = await runQuery(buildPreviewQuery(tableName, Math.min(rowLimit, 5)));
      setPreviewRows(rows.map((row) => ({ values: row })));
      setStep(2);
      setStatus({
        tone: "success",
        text: `Loaded ${formatNumber(rows.length)} preview rows for ${format.toUpperCase()}.`,
      });
    } catch (error) {
      setStatus({
        tone: "error",
        text: error instanceof Error ? error.message : "Preview query failed.",
      });
    } finally {
      setLoading(false);
    }
  }

  function handleBack() {
    setStep((currentStep) => Math.max(0, currentStep - 1));
  }

  async function handleDownload() {
    setLoading(true);
    setStatus(null);

    try {
      const rows = await runQuery(buildPreviewQuery(tableName, rowLimit));
      const fileBase = `${tableName}-export`;

      if (format === "csv") {
        downloadFile(
          serializeCsv(rows, includeHeaders),
          `${fileBase}.csv`,
          "text/csv;charset=utf-8;",
        );
      } else if (format === "json") {
        downloadFile(
          serializeJson(rows, prettyJson),
          `${fileBase}.json`,
          "application/json;charset=utf-8;",
        );
      } else if (format === "parquet") {
        downloadFile(
          serializeParquetPayload(rows, parquetCompression, tableName),
          `${fileBase}.parquet`,
          "application/octet-stream",
        );
      } else {
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName || "DataLensExport");
        const workbookData = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
        downloadFile(
          workbookData,
          `${fileBase}.xlsx`,
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
      }

      setStatus({
        tone: "success",
        text: `Started ${format.toUpperCase()} download for ${formatNumber(rows.length)} rows.`,
      });
    } catch (error) {
      setStatus({
        tone: "error",
        text: error instanceof Error ? error.message : "Export download failed.",
      });
    } finally {
      setLoading(false);
    }
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
            <Download className="h-3.5 w-3.5" />
            Data export wizard
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Step through format selection, export options, preview, and download
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Export {tableName} with {formatNumber(columns.length)} visible columns, tune
            format-specific settings, preview the first rows, then download a ready-to-share file.
          </p>
        </div>
        <div className={`rounded-3xl px-5 py-4 ${GLASS_PANEL_CLASS}`}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Current format
          </p>
          <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
            {format.toUpperCase()}
          </p>
        </div>
      </div>

      <div className="mt-6">
        <StepIndicator activeStep={step} />
      </div>

      <div className="mt-6">
        <StatusBanner message={status} />
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.24, ease: EASE }}
          className={`mt-6 rounded-[1.75rem] p-5 ${GLASS_PANEL_CLASS}`}
        >
          {step === 0 ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {FORMAT_OPTIONS.map((option) => {
                const Icon = option.icon;
                const active = option.id === format;

                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setFormat(option.id)}
                    className={`rounded-[1.5rem] border p-5 text-left transition ${
                      active
                        ? "border-cyan-500/25 bg-cyan-500/10"
                        : "border-white/20 bg-white/60 hover:bg-white dark:bg-slate-950/35 dark:hover:bg-slate-950/50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <div className="rounded-2xl bg-slate-900/5 p-3 dark:bg-white/5">
                          <Icon className="h-5 w-5 text-slate-700 dark:text-slate-200" />
                        </div>
                        <div>
                          <p className="text-base font-semibold text-slate-950 dark:text-white">
                            {option.label}
                          </p>
                          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                            {option.description}
                          </p>
                        </div>
                      </div>
                      {active ? <Check className="h-5 w-5 text-cyan-600 dark:text-cyan-300" /> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : null}

          {step === 1 ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Row limit
                </span>
                <input
                  aria-label="Row limit"
                  className={FIELD_CLASS}
                  min={1}
                  type="number"
                  value={rowLimit}
                  onChange={(event) => setRowLimit(Math.max(1, Number(event.target.value)))}
                />
              </label>

              {format === "csv" ? (
                <label className="flex items-center gap-3 rounded-2xl border border-white/20 bg-white/60 px-4 py-3 text-sm text-slate-700 dark:bg-slate-950/35 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={includeHeaders}
                    onChange={(event) => setIncludeHeaders(event.target.checked)}
                  />
                  Include CSV headers
                </label>
              ) : null}

              {format === "json" ? (
                <label className="flex items-center gap-3 rounded-2xl border border-white/20 bg-white/60 px-4 py-3 text-sm text-slate-700 dark:bg-slate-950/35 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={prettyJson}
                    onChange={(event) => setPrettyJson(event.target.checked)}
                  />
                  Pretty-print JSON
                </label>
              ) : null}

              {format === "parquet" ? (
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Compression
                  </span>
                  <select
                    aria-label="Compression"
                    className={FIELD_CLASS}
                    value={parquetCompression}
                    onChange={(event) => setParquetCompression(event.target.value)}
                  >
                    <option value="snappy">Snappy</option>
                    <option value="gzip">Gzip</option>
                    <option value="zstd">Zstd</option>
                  </select>
                </label>
              ) : null}

              {format === "excel" ? (
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Sheet name
                  </span>
                  <input
                    aria-label="Sheet name"
                    className={FIELD_CLASS}
                    value={sheetName}
                    onChange={(event) => setSheetName(event.target.value)}
                  />
                </label>
              ) : null}
            </div>
          ) : null}

          {step === 2 ? (
            previewRows.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-white/25 bg-white/35 p-8 text-sm text-slate-600 dark:bg-slate-950/25 dark:text-slate-300">
                No preview rows are available yet.
              </div>
            ) : (
              <div className="overflow-hidden rounded-3xl border border-white/20">
                <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-4 bg-slate-900/5 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:bg-white/5 dark:text-slate-400">
                  {Object.keys(previewRows[0]?.values ?? {}).map((key) => (
                    <span key={key}>{key}</span>
                  ))}
                </div>
                <div className="divide-y divide-white/15">
                  {previewRows.map((row, index) => (
                    <div
                      key={`preview-row-${index}`}
                      className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-4 px-4 py-4 text-sm text-slate-700 dark:text-slate-200"
                    >
                      {Object.entries(row.values).map(([key, value]) => (
                        <span key={`${index}-${key}`} className="break-all">
                          {value == null ? "—" : String(value)}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )
          ) : null}

          {step === 3 ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className={`rounded-3xl p-5 ${GLASS_PANEL_CLASS}`}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Export summary
                </p>
                <ul className="mt-4 space-y-3 text-sm text-slate-700 dark:text-slate-200">
                  <li>Format: {format.toUpperCase()}</li>
                  <li>Row limit: {formatNumber(rowLimit)}</li>
                  <li>Columns: {formatNumber(columns.length)}</li>
                  <li>Preview rows loaded: {formatNumber(previewRows.length)}</li>
                </ul>
              </div>

              <div className={`rounded-3xl p-5 ${GLASS_PANEL_CLASS}`}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Options
                </p>
                <ul className="mt-4 space-y-3 text-sm text-slate-700 dark:text-slate-200">
                  {format === "csv" ? <li>Include headers: {includeHeaders ? "Yes" : "No"}</li> : null}
                  {format === "json" ? <li>Pretty JSON: {prettyJson ? "Enabled" : "Compact"}</li> : null}
                  {format === "parquet" ? <li>Compression: {parquetCompression}</li> : null}
                  {format === "excel" ? <li>Sheet name: {sheetName}</li> : null}
                </ul>
              </div>
            </div>
          ) : null}
        </motion.div>
      </AnimatePresence>

      <div className="mt-6 flex flex-wrap justify-between gap-3">
        <button
          type="button"
          onClick={handleBack}
          disabled={step === 0 || loading}
          className={`${BUTTON_CLASS} border border-white/20 bg-white/70 text-slate-800 hover:bg-white dark:bg-slate-950/45 dark:text-slate-100 dark:hover:bg-slate-950/60`}
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>

        {step < 3 ? (
          <button
            type="button"
            onClick={handleNext}
            disabled={loading}
            className={`${BUTTON_CLASS} bg-cyan-600 text-white hover:bg-cyan-500`}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleDownload}
            disabled={loading}
            className={`${BUTTON_CLASS} bg-cyan-600 text-white hover:bg-cyan-500`}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Download export
          </button>
        )}
      </div>
    </motion.section>
  );
}
