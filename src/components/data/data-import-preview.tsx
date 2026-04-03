"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { FileSearch, Settings2, Table } from "lucide-react";
import type { ColumnProfile, ColumnType } from "@/types/dataset";

interface DataImportPreviewProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface ImportOptions {
  delimiter: string;
  encoding: string;
  headerRow: boolean;
}

interface ParsedPreview {
  headers: string[];
  rows: string[][];
  inferredTypes: ColumnType[];
}

const GLASS_PANEL =
  "bg-white/75 backdrop-blur-2xl dark:bg-slate-950/45 border border-white/20";
const PANEL_EASE = [0.22, 1, 0.36, 1] as const;
const DELIMITERS = [",", ";", "\t", "|"] as const;
const TYPE_OPTIONS: ColumnType[] = [
  "string",
  "number",
  "date",
  "boolean",
  "unknown",
];

function detectDelimiter(raw: string): string {
  const sample = raw.split(/\r?\n/).slice(0, 5).join("\n");
  const counts = DELIMITERS.map((delimiter) => ({
    delimiter,
    count: sample.split(delimiter).length,
  }));
  const winner = counts.sort((left, right) => right.count - left.count)[0];
  return winner?.delimiter ?? ",";
}

function detectEncoding(raw: string): string {
  if (raw.charCodeAt(0) === 0xfeff) {
    return "utf-8-bom";
  }

  return /[^\u0000-\u007f]/.test(raw) ? "utf-8" : "ascii";
}

function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      const nextCharacter = line[index + 1];
      if (inQuotes && nextCharacter === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  cells.push(current.trim());
  return cells;
}

function looksLikeHeader(firstRow: string[], secondRow: string[]): boolean {
  if (firstRow.length === 0 || secondRow.length === 0) {
    return true;
  }

  const firstRowNumeric = firstRow.filter((cell) => /^-?\d+(\.\d+)?$/.test(cell)).length;
  const secondRowNumeric = secondRow.filter((cell) => /^-?\d+(\.\d+)?$/.test(cell)).length;
  return firstRowNumeric < secondRowNumeric;
}

function inferColumnType(values: string[]): ColumnType {
  const filledValues = values.filter((value) => value.length > 0);

  if (filledValues.length === 0) {
    return "unknown";
  }

  if (filledValues.every((value) => /^-?\d+(\.\d+)?$/.test(value))) {
    return "number";
  }

  if (
    filledValues.every((value) =>
      /^(true|false|yes|no|0|1)$/i.test(value),
    )
  ) {
    return "boolean";
  }

  if (
    filledValues.every((value) => !Number.isNaN(new Date(value).getTime()))
  ) {
    return "date";
  }

  return "string";
}

function parsePreview(raw: string, options: ImportOptions): ParsedPreview {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(0, 101);
  const rows = lines.map((line) => splitLine(line, options.delimiter));
  const inferredHeaderRow =
    options.headerRow || looksLikeHeader(rows[0] ?? [], rows[1] ?? []);
  const width = Math.max(...rows.map((row) => row.length), 0);
  const normalizedRows = rows.map((row) =>
    Array.from({ length: width }, (_, index) => row[index] ?? ""),
  );
  const headers = inferredHeaderRow
    ? normalizedRows[0]?.map((value, index) => value || `Column ${index + 1}`) ?? []
    : Array.from({ length: width }, (_, index) => `Column ${index + 1}`);
  const previewRows = inferredHeaderRow ? normalizedRows.slice(1, 101) : normalizedRows;
  const inferredTypes = headers.map((_, columnIndex) =>
    inferColumnType(previewRows.map((row) => row[columnIndex] ?? "")),
  );

  return { headers, rows: previewRows, inferredTypes };
}

export default function DataImportPreview({
  tableName,
  columns,
}: DataImportPreviewProps) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [rawText, setRawText] = useState("");
  const [options, setOptions] = useState<ImportOptions>({
    delimiter: ",",
    encoding: "utf-8",
    headerRow: true,
  });
  const [preview, setPreview] = useState<ParsedPreview | null>(null);
  const [overrides, setOverrides] = useState<Record<string, ColumnType>>({});
  const [status, setStatus] = useState<string | null>(null);

  function syncPreview(nextRawText: string, nextOptions: ImportOptions) {
    const nextPreview = parsePreview(nextRawText, nextOptions);
    setPreview(nextPreview);
    setOverrides((current) =>
      Object.fromEntries(
        nextPreview.headers.map((header, index) => [
          header,
          current[header] ?? nextPreview.inferredTypes[index] ?? "unknown",
        ]),
      ),
    );
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const nextRawText = await file.text();
    const nextOptions: ImportOptions = {
      delimiter: detectDelimiter(nextRawText),
      encoding: detectEncoding(nextRawText),
      headerRow: looksLikeHeader(
        splitLine(nextRawText.split(/\r?\n/)[0] ?? "", detectDelimiter(nextRawText)),
        splitLine(nextRawText.split(/\r?\n/)[1] ?? "", detectDelimiter(nextRawText)),
      ),
    };

    setFileName(file.name);
    setRawText(nextRawText);
    setOptions(nextOptions);
    syncPreview(nextRawText, nextOptions);
    setStatus(`Loaded preview for ${file.name}.`);
  }

  function updateOptions(patch: Partial<ImportOptions>) {
    if (!rawText) {
      return;
    }

    const nextOptions = { ...options, ...patch };
    setOptions(nextOptions);
    syncPreview(rawText, nextOptions);
  }

  function updateOverride(header: string, value: ColumnType) {
    setOverrides((current) => ({ ...current, [header]: value }));
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: PANEL_EASE }}
      className={`overflow-hidden rounded-[2rem] ${GLASS_PANEL}`}
    >
      <div className="border-b border-white/15 px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-700 dark:text-sky-300">
            <FileSearch className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
              Data import preview
            </p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950 dark:text-slate-50">
              Inspect import settings before loading into {tableName}
            </h2>
          </div>
        </div>
      </div>

      <div className="grid gap-5 px-5 py-5 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-4">
          <div className="rounded-[1.75rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/35">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                Upload delimited file
              </span>
              <input
                type="file"
                accept=".csv,.txt,.tsv"
                onChange={handleFileChange}
                className="mt-2 block w-full rounded-2xl border border-white/15 bg-white/70 px-4 py-3 text-sm text-slate-900 outline-none dark:bg-slate-950/55 dark:text-slate-50"
              />
            </label>

            <div className="mt-4 rounded-2xl bg-white/60 px-4 py-3 text-sm text-slate-600 dark:bg-slate-950/35 dark:text-slate-300">
              Existing schema reference: {columns.length} known columns
            </div>
            {fileName ? (
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                File: <span className="font-medium">{fileName}</span>
              </p>
            ) : null}
            {status ? (
              <p className="mt-3 rounded-2xl bg-sky-500/10 px-4 py-3 text-sm text-sky-700 dark:text-sky-300">
                {status}
              </p>
            ) : null}
          </div>

          <div className="rounded-[1.75rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/35">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <Settings2 className="h-4 w-4 text-sky-600" />
              Import options
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                  Delimiter
                </span>
                <select
                  value={options.delimiter}
                  onChange={(event) =>
                    updateOptions({ delimiter: event.target.value })
                  }
                  className="w-full rounded-2xl border border-white/15 bg-white/80 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/55 dark:text-slate-50"
                >
                  {DELIMITERS.map((delimiter) => (
                    <option key={delimiter} value={delimiter}>
                      {delimiter === "\t" ? "tab" : delimiter}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                  Encoding
                </span>
                <select
                  value={options.encoding}
                  onChange={(event) =>
                    updateOptions({ encoding: event.target.value })
                  }
                  className="w-full rounded-2xl border border-white/15 bg-white/80 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/55 dark:text-slate-50"
                >
                  <option value="ascii">ascii</option>
                  <option value="utf-8">utf-8</option>
                  <option value="utf-8-bom">utf-8-bom</option>
                </select>
              </label>

              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                  Header row
                </span>
                <select
                  value={String(options.headerRow)}
                  onChange={(event) =>
                    updateOptions({ headerRow: event.target.value === "true" })
                  }
                  className="w-full rounded-2xl border border-white/15 bg-white/80 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/55 dark:text-slate-50"
                >
                  <option value="true">present</option>
                  <option value="false">absent</option>
                </select>
              </label>
            </div>
          </div>

          {preview ? (
            <div className="rounded-[1.75rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/35">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <Table className="h-4 w-4 text-sky-600" />
                Type inference
              </div>

              <div className="mt-4 space-y-3">
                {preview.headers.map((header, index) => (
                  <div
                    key={header}
                    className="grid gap-3 rounded-2xl border border-white/15 bg-white/55 p-3 dark:bg-slate-950/30 md:grid-cols-[minmax(0,1fr)_150px]"
                  >
                    <div>
                      <p className="font-medium text-slate-900 dark:text-slate-100">
                        {header}
                      </p>
                      <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        inferred {preview.inferredTypes[index]}
                      </p>
                    </div>
                    <select
                      value={overrides[header] ?? preview.inferredTypes[index]}
                      onChange={(event) =>
                        updateOverride(header, event.target.value as ColumnType)
                      }
                      aria-label={`Type override for ${header}`}
                      className="rounded-2xl border border-white/15 bg-white/80 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/55 dark:text-slate-50"
                    >
                      {TYPE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="rounded-[1.75rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/35">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            First 100 rows preview
          </h3>
          {preview ? (
            <div className="mt-4 overflow-auto rounded-[1.5rem] border border-white/15">
              <table className="min-w-full border-separate border-spacing-0 text-sm">
                <thead className="sticky top-0 bg-white/90 backdrop-blur-2xl dark:bg-slate-950/85">
                  <tr>
                    {preview.headers.map((header) => (
                      <th
                        key={header}
                        className="border-b border-white/15 px-4 py-3 text-left font-semibold text-slate-900 dark:text-slate-100"
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, rowIndex) => (
                    <tr key={`${rowIndex}-${row.join("|")}`}>
                      {row.map((cell, cellIndex) => (
                        <td
                          key={`${rowIndex}-${cellIndex}`}
                          className="border-b border-white/10 px-4 py-3 text-slate-700 dark:text-slate-200"
                        >
                          {cell || "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-4 rounded-[1.5rem] border border-dashed border-white/20 px-5 py-14 text-center text-sm text-slate-500 dark:text-slate-400">
              Upload a file to inspect delimiter detection, inferred types, and the
              first 100 rows before import.
            </div>
          )}
        </div>
      </div>
    </motion.section>
  );
}
