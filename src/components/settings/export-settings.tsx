"use client";

import { motion } from "framer-motion";
import { startTransition, useMemo, useState } from "react";
import {
  Download,
  FileCode2,
  FileJson,
  FileSpreadsheet,
  TextCursorInput,
  SeparatorHorizontal,
} from "lucide-react";
import {
  ANALYTICS_EASE,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  isRecord,
} from "@/lib/utils/advanced-analytics";

type ExportFormat = "csv" | "json" | "html";
type DateFormat = "iso" | "locale" | "timestamp";
type CsvDelimiter = "," | ";" | "\t" | "|";

interface ExportSettingsState {
  format: ExportFormat;
  includeHeaders: boolean;
  dateFormat: DateFormat;
  delimiter: CsvDelimiter;
}

const STORAGE_KEY = "datalens:export-settings";
const DEFAULT_SETTINGS: ExportSettingsState = {
  format: "csv",
  includeHeaders: true,
  dateFormat: "iso",
  delimiter: ",",
};

const FORMAT_OPTIONS = [
  {
    value: "csv",
    label: "CSV",
    description: "Table-first export for spreadsheets.",
    icon: FileSpreadsheet,
  },
  {
    value: "json",
    label: "JSON",
    description: "Structured records for APIs and scripts.",
    icon: FileJson,
  },
  {
    value: "html",
    label: "HTML",
    description: "Portable report-style snapshot.",
    icon: FileCode2,
  },
] as const;

function readExportSettings(): ExportSettingsState {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return DEFAULT_SETTINGS;

    return {
      format:
        parsed.format === "json" || parsed.format === "html"
          ? parsed.format
          : DEFAULT_SETTINGS.format,
      includeHeaders:
        typeof parsed.includeHeaders === "boolean"
          ? parsed.includeHeaders
          : DEFAULT_SETTINGS.includeHeaders,
      dateFormat:
        parsed.dateFormat === "locale" || parsed.dateFormat === "timestamp"
          ? parsed.dateFormat
          : DEFAULT_SETTINGS.dateFormat,
      delimiter:
        parsed.delimiter === ";" ||
        parsed.delimiter === "\t" ||
        parsed.delimiter === "|"
          ? parsed.delimiter
          : DEFAULT_SETTINGS.delimiter,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveExportSettings(settings: ExportSettingsState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function delimiterLabel(delimiter: CsvDelimiter) {
  if (delimiter === "\t") return "Tab";
  if (delimiter === ";") return "Semicolon";
  if (delimiter === "|") return "Pipe";
  return "Comma";
}

function sampleDate(format: DateFormat) {
  const date = new Date("2026-04-03T14:30:00.000Z");
  if (format === "timestamp") return String(date.getTime());
  if (format === "locale") return date.toLocaleString("en-US");
  return date.toISOString();
}

function buildPreview(settings: ExportSettingsState) {
  const dateValue = sampleDate(settings.dateFormat);

  if (settings.format === "json") {
    return JSON.stringify(
      [
        {
          id: 101,
          created_at: dateValue,
          revenue: 1450.75,
        },
      ],
      null,
      2,
    );
  }

  if (settings.format === "html") {
    return [
      "<table>",
      "  <thead><tr><th>id</th><th>created_at</th><th>revenue</th></tr></thead>",
      `  <tbody><tr><td>101</td><td>${dateValue}</td><td>1450.75</td></tr></tbody>`,
      "</table>",
    ].join("\n");
  }

  const delimiter = settings.delimiter;
  const rows = settings.includeHeaders
    ? [
        `id${delimiter}created_at${delimiter}revenue`,
        `101${delimiter}${dateValue}${delimiter}1450.75`,
      ]
    : [`101${delimiter}${dateValue}${delimiter}1450.75`];

  return rows.join("\n");
}

function SettingToggle({
  checked,
  label,
  description,
  onChange,
}: {
  checked: boolean;
  label: string;
  description: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className={`${GLASS_CARD_CLASS} flex items-center justify-between gap-4 p-4 text-left`}
    >
      <div>
        <p className="font-medium text-slate-950 dark:text-white">{label}</p>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {description}
        </p>
      </div>
      <span
        className={
          checked
            ? "rounded-full bg-cyan-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300"
            : "rounded-full bg-slate-300/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600 dark:bg-slate-800 dark:text-slate-300"
        }
      >
        {checked ? "On" : "Off"}
      </span>
    </button>
  );
}

export default function ExportSettings() {
  const [settings, setSettings] = useState<ExportSettingsState>(() =>
    readExportSettings(),
  );
  const [notice, setNotice] = useState("Export preferences are stored locally.");

  const preview = useMemo(() => buildPreview(settings), [settings]);
  const summary = useMemo(
    () =>
      `${settings.format.toUpperCase()} · ${settings.includeHeaders ? "headers on" : "headers off"} · ${settings.dateFormat} dates`,
    [settings],
  );

  function updateSettings(next: ExportSettingsState) {
    setSettings(next);
    saveExportSettings(next);
    setNotice("Export preferences saved to localStorage.");
  }

  function patchSettings(patch: Partial<ExportSettingsState>) {
    startTransition(() => {
      updateSettings({
        ...settings,
        ...patch,
      });
    });
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <Download className="h-3.5 w-3.5" />
            Export settings
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Set default export behavior for files leaving DataLens
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Choose a preferred output format, keep or remove headers, define how
            dates should be serialized, and set the default CSV delimiter.
          </p>
        </div>

        <div className={`${GLASS_CARD_CLASS} max-w-md p-4`}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Current profile
          </p>
          <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
            {summary}
          </p>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            {notice}
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.1fr,0.9fr]">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: ANALYTICS_EASE }}
          className="space-y-5"
        >
          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Default format
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {FORMAT_OPTIONS.map(({ value, label, description, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={settings.format === value}
                  onClick={() => patchSettings({ format: value })}
                  className={
                    settings.format === value
                      ? "rounded-3xl border border-cyan-400/40 bg-cyan-500/15 p-4 text-left text-cyan-800 dark:text-cyan-200"
                      : `${GLASS_CARD_CLASS} p-4 text-left`
                  }
                >
                  <Icon className="h-5 w-5" />
                  <p className="mt-3 font-medium">{label}</p>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    {description}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <SettingToggle
            checked={settings.includeHeaders}
            label="Include headers"
            description="Keep the source column names in exported tables."
            onChange={(value) => patchSettings({ includeHeaders: value })}
          />

          <div className={`${GLASS_CARD_CLASS} grid gap-4 p-5 md:grid-cols-2`}>
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Date format
              </span>
              <select
                value={settings.dateFormat}
                onChange={(event) =>
                  patchSettings({
                    dateFormat: event.target.value as DateFormat,
                  })
                }
                className={FIELD_CLASS}
              >
                <option value="iso">ISO 8601</option>
                <option value="locale">Locale string</option>
                <option value="timestamp">Unix timestamp</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                CSV delimiter
              </span>
              <select
                value={settings.delimiter}
                onChange={(event) =>
                  patchSettings({
                    delimiter: event.target.value as CsvDelimiter,
                  })
                }
                className={FIELD_CLASS}
                disabled={settings.format !== "csv"}
              >
                <option value=",">Comma</option>
                <option value=";">Semicolon</option>
                <option value="\t">Tab</option>
                <option value="|">Pipe</option>
              </select>
            </label>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: ANALYTICS_EASE, delay: 0.04 }}
          className={`${GLASS_CARD_CLASS} p-5`}
        >
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Preview
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-3xl border border-white/20 bg-white/60 p-4 dark:bg-slate-950/30">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                <TextCursorInput className="h-4 w-4" />
                Headers
              </div>
              <p className="mt-3 text-lg font-semibold text-slate-950 dark:text-white">
                {settings.includeHeaders ? "Included" : "Removed"}
              </p>
            </div>
            <div className="rounded-3xl border border-white/20 bg-white/60 p-4 dark:bg-slate-950/30">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                <SeparatorHorizontal className="h-4 w-4" />
                Delimiter
              </div>
              <p className="mt-3 text-lg font-semibold text-slate-950 dark:text-white">
                {delimiterLabel(settings.delimiter)}
              </p>
            </div>
          </div>

          <pre className="mt-4 overflow-x-auto rounded-3xl border border-white/20 bg-slate-950 px-4 py-4 text-xs leading-6 text-slate-100">
            <code>{preview}</code>
          </pre>

          <div className="mt-4 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <Download className="h-4 w-4 text-cyan-500" />
            Future exports will default to {settings.format.toUpperCase()} with{" "}
            {settings.dateFormat} date serialization.
          </div>
        </motion.div>
      </div>
    </section>
  );
}
