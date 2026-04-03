"use client";

import {
  useMemo,
  useRef,
  useState,
  startTransition,
  type ChangeEvent,
  type DragEvent,
} from "react";
import Papa from "papaparse";
import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCircle2,
  Database,
  FileJson,
  FileSpreadsheet,
  Globe,
  Loader2,
  ClipboardPaste,
  Sparkles,
  Upload,
} from "lucide-react";
import {
  getConnection,
  initDuckDB,
  loadCSVIntoDB,
  runQuery,
} from "@/lib/duckdb/client";
import { profileTable } from "@/lib/duckdb/profiler";
import { formatBytes, sanitizeTableName } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface DataConnectorProps {
  onDataLoaded: (result: { tableName: string; columns: ColumnProfile[] }) => void;
}

type ConnectorTab =
  | "csv"
  | "json"
  | "parquet"
  | "url"
  | "paste"
  | "samples";

type RemoteFileType = "csv" | "json";

interface PreviewState {
  rows: Record<string, unknown>[];
  columns: string[];
  sourceLabel: string;
}

interface SampleDataset {
  id: string;
  label: string;
  description: string;
  type: "csv";
  fileName: string;
  content: string;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const CARD_CLASS =
  "rounded-[1.75rem] border border-white/20 bg-white/75 p-5 shadow-xl shadow-slate-950/10 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const TAB_OPTIONS: Array<{
  value: ConnectorTab;
  label: string;
  icon: typeof Upload;
}> = [
  { value: "csv", label: "CSV Upload", icon: Upload },
  { value: "json", label: "JSON Upload", icon: FileJson },
  { value: "parquet", label: "Parquet Upload", icon: Database },
  { value: "url", label: "URL Import", icon: Globe },
  { value: "paste", label: "Paste Data", icon: ClipboardPaste },
  { value: "samples", label: "Sample Datasets", icon: Sparkles },
] as const;

const SAMPLE_DATASETS: SampleDataset[] = [
  {
    id: "iris",
    label: "Iris",
    description: "Classic flower measurements with species labels.",
    type: "csv",
    fileName: "iris.csv",
    content: [
      "sepal_length,sepal_width,petal_length,petal_width,species",
      "5.1,3.5,1.4,0.2,setosa",
      "4.9,3.0,1.4,0.2,setosa",
      "6.2,3.4,5.4,2.3,virginica",
      "5.9,3.0,5.1,1.8,virginica",
      "6.0,2.2,4.0,1.0,versicolor",
      "5.5,2.4,3.7,1.0,versicolor",
    ].join("\n"),
  },
  {
    id: "titanic",
    label: "Titanic",
    description: "Passenger survival sample with age, fare, and class.",
    type: "csv",
    fileName: "titanic.csv",
    content: [
      "passenger_id,survived,pclass,sex,age,fare,embarked",
      "1,0,3,male,22,7.25,S",
      "2,1,1,female,38,71.2833,C",
      "3,1,3,female,26,7.925,S",
      "4,1,1,female,35,53.1,S",
      "5,0,3,male,35,8.05,S",
      "6,0,3,male,27,8.4583,Q",
    ].join("\n"),
  },
  {
    id: "sales",
    label: "Sales",
    description: "Regional product sales with units, revenue, and profit.",
    type: "csv",
    fileName: "sales.csv",
    content: [
      "date,region,product,units,revenue,profit",
      "2026-01-03,North,Analytics,28,12600,3900",
      "2026-01-04,West,Warehouse,18,8100,2400",
      "2026-01-05,EMEA,Studio,11,9900,3350",
      "2026-01-06,APAC,Analytics,33,14850,4740",
      "2026-01-07,North,Sensor,44,11880,3010",
      "2026-01-08,West,Studio,9,8100,2810",
    ].join("\n"),
  },
  {
    id: "weather",
    label: "Weather",
    description: "Daily weather observations across multiple cities.",
    type: "csv",
    fileName: "weather.csv",
    content: [
      "date,city,temperature,humidity,wind_speed,condition",
      "2026-02-01,Athens,17.4,58,11,Sunny",
      "2026-02-01,Berlin,6.1,72,18,Cloudy",
      "2026-02-01,Chicago,-2.3,66,24,Snow",
      "2026-02-02,Athens,18.2,55,9,Sunny",
      "2026-02-02,Berlin,5.8,70,16,Rain",
      "2026-02-02,Chicago,-1.1,63,21,Cloudy",
    ].join("\n"),
  },
  {
    id: "stocks",
    label: "Stocks",
    description: "Simple OHLCV market data for a handful of trading days.",
    type: "csv",
    fileName: "stocks.csv",
    content: [
      "date,symbol,open,high,low,close,volume",
      "2026-03-03,DLNS,82.4,84.2,81.8,83.7,1240000",
      "2026-03-04,DLNS,83.7,85.5,83.0,84.9,1420000",
      "2026-03-05,DLNS,84.9,86.1,84.3,85.4,1180000",
      "2026-03-06,DLNS,85.4,86.9,85.1,86.2,1600000",
      "2026-03-07,DLNS,86.2,87.0,85.6,86.8,1360000",
    ].join("\n"),
  },
  {
    id: "movies",
    label: "Movies",
    description: "Movie ratings, genres, runtime, and global grosses.",
    type: "csv",
    fileName: "movies.csv",
    content: [
      "title,genre,year,rating,runtime_minutes,worldwide_gross_m",
      "Signal Drift,Sci-Fi,2021,7.8,118,424",
      "Paper Skyline,Drama,2022,8.1,132,189",
      "Northern Circuit,Thriller,2023,6.9,104,95",
      "Atlas Run,Action,2024,7.4,126,512",
      "Glass Summer,Romance,2025,7.2,109,148",
      "Golden Hour,Comedy,2025,7.6,101,203",
    ].join("\n"),
  },
] as const;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function safeTableName(value: string): string {
  return sanitizeTableName(value).toLowerCase();
}

function detectEncoding(buffer: Uint8Array): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return "UTF-8 with BOM";
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return "UTF-16 LE";
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return "UTF-16 BE";
  }
  return "Likely UTF-8";
}

function parsePreviewFromDelimitedText(text: string): PreviewState {
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true,
    preview: 5,
    dynamicTyping: true,
  });

  const columns = parsed.meta.fields ?? Object.keys(parsed.data[0] ?? {});
  return {
    rows: parsed.data.slice(0, 5),
    columns,
    sourceLabel: "Preview",
  };
}

function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (const char of input) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseStructKeys(typeDefinition: string): string[] {
  const match = /^STRUCT\((.*)\)$/i.exec(typeDefinition.trim());
  if (!match) return [];
  return splitTopLevel(match[1])
    .map((entry) => entry.trim().split(/\s+/)[0]?.replace(/"/g, ""))
    .filter((entry): entry is string => Boolean(entry));
}

async function loadJsonIntoFlattenedTable(
  tableName: string,
  jsonContent: string,
): Promise<void> {
  const database = await initDuckDB();
  const fileName = `${tableName}.json`;
  const rawTableName = `${tableName}__raw_json`;
  await database.registerFileText(fileName, jsonContent);
  const connection = await getConnection();
  await connection.query(
    `CREATE OR REPLACE TABLE ${quoteIdentifier(rawTableName)} AS SELECT * FROM read_json_auto('${fileName}')`,
  );

  const schemaRows = await runQuery(`DESCRIBE ${quoteIdentifier(rawTableName)}`);
  const selectExpressions: string[] = [];

  for (const row of schemaRows) {
    const columnName = String(row.column_name ?? "");
    const columnType = String(row.column_type ?? "");

    if (!columnName) continue;

    if (columnType.toUpperCase().startsWith("STRUCT(")) {
      const keys = parseStructKeys(columnType);
      if (keys.length === 0) {
        selectExpressions.push(
          `CAST(${quoteIdentifier(columnName)} AS VARCHAR) AS ${quoteIdentifier(columnName)}`,
        );
        continue;
      }

      for (const key of keys) {
        selectExpressions.push(
          `${quoteIdentifier(columnName)}.${quoteIdentifier(key)} AS ${quoteIdentifier(`${columnName}_${key}`)}`,
        );
      }
      continue;
    }

    if (columnType.toUpperCase().includes("[]") || columnType.toUpperCase().startsWith("MAP(")) {
      selectExpressions.push(
        `CAST(${quoteIdentifier(columnName)} AS VARCHAR) AS ${quoteIdentifier(columnName)}`,
      );
      continue;
    }

    selectExpressions.push(quoteIdentifier(columnName));
  }

  const selectList = selectExpressions.length > 0 ? selectExpressions.join(", ") : "*";
  await connection.query(
    `CREATE OR REPLACE TABLE ${quoteIdentifier(tableName)} AS SELECT ${selectList} FROM ${quoteIdentifier(rawTableName)}`,
  );
  await connection.query(`DROP TABLE IF EXISTS ${quoteIdentifier(rawTableName)}`);
}

async function loadParquetFile(tableName: string, file: File): Promise<void> {
  const database = await initDuckDB();
  const buffer = new Uint8Array(await file.arrayBuffer());
  await database.registerFileBuffer(file.name, buffer);
  const connection = await getConnection();
  await connection.query(
    `CREATE OR REPLACE TABLE ${quoteIdentifier(tableName)} AS SELECT * FROM read_parquet('${file.name}')`,
  );
}

function PreviewTable({ preview }: { preview: PreviewState | null }) {
  if (!preview || preview.columns.length === 0) {
    return (
      <div className="rounded-[1.25rem] border border-dashed border-white/20 px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
        Drag in a file or load a sample to see the first five rows.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[1.25rem] border border-white/15 bg-white/50 dark:bg-slate-900/35">
      <div className="border-b border-white/15 px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
        {preview.sourceLabel}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-white/60 dark:bg-slate-900/60">
            <tr>
              {preview.columns.map((column) => (
                <th
                  key={column}
                  className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row, index) => (
              <tr key={`preview-row-${index}`} className="border-t border-white/10">
                {preview.columns.map((column) => (
                  <td key={`${index}-${column}`} className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {String(row[column] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SampleDatasetCard({
  dataset,
  onLoad,
}: {
  dataset: SampleDataset;
  onLoad: (dataset: SampleDataset) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onLoad(dataset)}
      className="rounded-[1.5rem] border border-white/20 bg-white/55 p-4 text-left transition hover:-translate-y-0.5 hover:bg-white/70 dark:bg-slate-900/40 dark:hover:bg-slate-900/55"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
          <FileSpreadsheet className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">{dataset.label}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{dataset.fileName}</p>
        </div>
      </div>
      <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{dataset.description}</p>
    </button>
  );
}

export default function DataConnector({ onDataLoaded }: DataConnectorProps) {
  const csvInputRef = useRef<HTMLInputElement | null>(null);
  const jsonInputRef = useRef<HTMLInputElement | null>(null);
  const parquetInputRef = useRef<HTMLInputElement | null>(null);
  const [activeTab, setActiveTab] = useState<ConnectorTab>("csv");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState<string>("Ready to import data.");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [fileMeta, setFileMeta] = useState<{ size: number; encoding: string } | null>(null);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [pastedText, setPastedText] = useState("");

  const currentTabMeta = useMemo(
    () => TAB_OPTIONS.find((tab) => tab.value === activeTab) ?? TAB_OPTIONS[0],
    [activeTab],
  );

  async function finalizeLoadedTable(tableName: string, sourceLabel: string) {
    const [rows, columns] = await Promise.all([
      runQuery(`SELECT * FROM ${quoteIdentifier(tableName)} LIMIT 5`),
      profileTable(tableName),
    ]);

    startTransition(() => {
      setPreview({
        rows,
        columns: Object.keys(rows[0] ?? {}),
        sourceLabel,
      });
      setStatus(`Loaded ${tableName} into DuckDB.`);
      setError(null);
    });

    onDataLoaded({ tableName, columns });
  }

  async function withProgress(task: () => Promise<void>) {
    setLoading(true);
    setProgress(6);
    setError(null);

    const timer = window.setInterval(() => {
      setProgress((current) => Math.min(current + 11, 88));
    }, 160);

    try {
      await task();
      window.clearInterval(timer);
      setProgress(100);
    } catch (taskError) {
      window.clearInterval(timer);
      setError(taskError instanceof Error ? taskError.message : "Import failed.");
      setStatus("Import failed.");
    } finally {
      setLoading(false);
      window.setTimeout(() => setProgress(0), 600);
    }
  }

  async function importDelimitedFile(file: File) {
    const content = await file.text();
    const tableName = safeTableName(file.name);
    setPreview({ ...parsePreviewFromDelimitedText(content), sourceLabel: "CSV preview" });
    await loadCSVIntoDB(tableName, content);
    await finalizeLoadedTable(tableName, `${file.name} preview`);
  }

  async function importJsonFile(file: File) {
    const content = await file.text();
    const tableName = safeTableName(file.name);
    await loadJsonIntoFlattenedTable(tableName, content);
    await finalizeLoadedTable(tableName, `${file.name} preview`);
  }

  async function importParquet(file: File) {
    const tableName = safeTableName(file.name);
    await loadParquetFile(tableName, file);
    await finalizeLoadedTable(tableName, `${file.name} preview`);
  }

  function updateFileMeta(file: File, bytes: Uint8Array) {
    setFileMeta({ size: file.size, encoding: detectEncoding(bytes) });
  }

  async function handleFileSelection(
    event: ChangeEvent<HTMLInputElement>,
    type: "csv" | "json" | "parquet",
  ) {
    const file = event.target.files?.[0];
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    updateFileMeta(file, bytes);

    await withProgress(async () => {
      if (type === "csv") {
        await importDelimitedFile(file);
      } else if (type === "json") {
        await importJsonFile(file);
      } else {
        await importParquet(file);
      }
    });

    event.target.value = "";
  }

  async function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) return;

    const bytes = new Uint8Array(await file.arrayBuffer());
    updateFileMeta(file, bytes);

    await withProgress(async () => {
      await importDelimitedFile(file);
    });
  }

  async function handleRemoteImport() {
    const trimmedUrl = remoteUrl.trim();
    if (!trimmedUrl) {
      setError("Enter a CSV or JSON URL first.");
      return;
    }

    await withProgress(async () => {
      const response = await fetch(trimmedUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${trimmedUrl}`);
      }

      const contentType = response.headers.get("content-type") ?? "";
      const remoteType: RemoteFileType =
        trimmedUrl.toLowerCase().endsWith(".json") || contentType.includes("json")
          ? "json"
          : "csv";
      const content = await response.text();
      const tableName = safeTableName(trimmedUrl.split("/").pop() ?? `remote_${Date.now()}`);

      if (remoteType === "json") {
        await loadJsonIntoFlattenedTable(tableName, content);
      } else {
        setPreview({ ...parsePreviewFromDelimitedText(content), sourceLabel: "Remote preview" });
        await loadCSVIntoDB(tableName, content);
      }

      setFileMeta({
        size: new TextEncoder().encode(content).length,
        encoding: "Fetched via browser",
      });
      await finalizeLoadedTable(tableName, `Imported from ${trimmedUrl}`);
    });
  }

  async function handlePasteImport() {
    const text = pastedText.trim();
    if (!text) {
      setError("Paste CSV or TSV content before importing.");
      return;
    }

    await withProgress(async () => {
      const normalized = text.includes("\t") && !text.includes(",")
        ? text
            .split("\n")
            .map((line) => line.split("\t").join(","))
            .join("\n")
        : text;
      const tableName = safeTableName(`pasted_data_${Date.now()}`);
      setPreview({ ...parsePreviewFromDelimitedText(normalized), sourceLabel: "Pasted preview" });
      await loadCSVIntoDB(tableName, normalized);
      setFileMeta({
        size: new TextEncoder().encode(normalized).length,
        encoding: "Typed or pasted text",
      });
      await finalizeLoadedTable(tableName, "Pasted data preview");
    });
  }

  async function handleSampleLoad(dataset: SampleDataset) {
    await withProgress(async () => {
      const tableName = safeTableName(dataset.fileName);
      setPreview({
        ...parsePreviewFromDelimitedText(dataset.content),
        sourceLabel: `${dataset.label} preview`,
      });
      await loadCSVIntoDB(tableName, dataset.content);
      setFileMeta({
        size: new TextEncoder().encode(dataset.content).length,
        encoding: "Bundled sample",
      });
      await finalizeLoadedTable(tableName, `${dataset.label} sample preview`);
    });
  }

  return (
    <section className={`${CARD_CLASS} overflow-hidden`}>
      <div className="flex flex-col gap-5 border-b border-white/15 pb-5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-[1.25rem] bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
            <Database className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
              Data Connector
            </p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950 dark:text-slate-50">
              Import data from files, URLs, pasted text, or bundled samples
            </h2>
          </div>
        </div>
        <div className="rounded-[1.1rem] border border-white/15 bg-white/50 px-4 py-3 text-sm text-slate-600 dark:bg-slate-900/35 dark:text-slate-300">
          {status}
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
            {TAB_OPTIONS.map((tab) => {
              const Icon = tab.icon;
              const active = tab.value === activeTab;
              return (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setActiveTab(tab.value)}
                  className={`rounded-[1.15rem] border px-3 py-3 text-left text-sm transition ${
                    active
                      ? "border-cyan-400/40 bg-cyan-500/12 text-cyan-700 dark:border-cyan-400/30 dark:text-cyan-300"
                      : "border-white/15 bg-white/50 text-slate-600 hover:bg-white/70 dark:bg-slate-900/35 dark:text-slate-300 dark:hover:bg-slate-900/50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4" />
                    <span>{tab.label}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {loading ? (
            <div className="rounded-[1.25rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/35">
              <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
                <Loader2 className="h-4 w-4 animate-spin" />
                Import in progress
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-800/70">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-sky-500"
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.25, ease: EASE }}
                />
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="rounded-[1.25rem] border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
              {error}
            </div>
          ) : null}

          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.28, ease: EASE }}
              className="rounded-[1.4rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30"
            >
              {activeTab === "csv" ? (
                <div className="space-y-4">
                  <button
                    type="button"
                    onDragOver={(event) => {
                      event.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(event) => void handleDrop(event)}
                    onClick={() => csvInputRef.current?.click()}
                    className={`flex min-h-52 w-full flex-col items-center justify-center gap-3 rounded-[1.4rem] border border-dashed px-5 py-8 text-center transition ${
                      isDragging
                        ? "border-cyan-400/50 bg-cyan-500/10"
                        : "border-white/20 bg-white/55 hover:bg-white/70 dark:bg-slate-950/30"
                    }`}
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
                      <Upload className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-base font-semibold text-slate-900 dark:text-slate-50">
                        Drop a CSV or TSV file here
                      </p>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        First five rows are previewed before the DuckDB table is finalized.
                      </p>
                    </div>
                  </button>
                  <input
                    ref={csvInputRef}
                    type="file"
                    accept=".csv,.tsv,text/csv,text/tab-separated-values"
                    className="hidden"
                    onChange={(event) => void handleFileSelection(event, "csv")}
                  />
                </div>
              ) : null}

              {activeTab === "json" ? (
                <div className="space-y-4">
                  <button
                    type="button"
                    onClick={() => jsonInputRef.current?.click()}
                    className="flex min-h-44 w-full flex-col items-center justify-center gap-3 rounded-[1.4rem] border border-dashed border-white/20 bg-white/55 px-5 py-8 text-center transition hover:bg-white/70 dark:bg-slate-950/30"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/10 text-violet-700 dark:text-violet-300">
                      <FileJson className="h-5 w-5" />
                    </div>
                    <p className="text-base font-semibold text-slate-900 dark:text-slate-50">
                      Load nested JSON and flatten structs into tabular columns
                    </p>
                  </button>
                  <input
                    ref={jsonInputRef}
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={(event) => void handleFileSelection(event, "json")}
                  />
                </div>
              ) : null}

              {activeTab === "parquet" ? (
                <div className="space-y-4">
                  <button
                    type="button"
                    onClick={() => parquetInputRef.current?.click()}
                    className="flex min-h-44 w-full flex-col items-center justify-center gap-3 rounded-[1.4rem] border border-dashed border-white/20 bg-white/55 px-5 py-8 text-center transition hover:bg-white/70 dark:bg-slate-950/30"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                      <Database className="h-5 w-5" />
                    </div>
                    <p className="text-base font-semibold text-slate-900 dark:text-slate-50">
                      Register a Parquet file with DuckDB-WASM and load it directly
                    </p>
                  </button>
                  <input
                    ref={parquetInputRef}
                    type="file"
                    accept=".parquet,application/octet-stream"
                    className="hidden"
                    onChange={(event) => void handleFileSelection(event, "parquet")}
                  />
                </div>
              ) : null}

              {activeTab === "url" ? (
                <div className="space-y-4">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
                    Remote CSV or JSON URL
                  </label>
                  <input
                    value={remoteUrl}
                    onChange={(event) => setRemoteUrl(event.target.value)}
                    placeholder="https://example.com/data.csv"
                    className="w-full rounded-[1rem] border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-900 outline-none dark:bg-slate-950/60 dark:text-slate-50"
                  />
                  <button
                    type="button"
                    onClick={() => void handleRemoteImport()}
                    className="inline-flex items-center gap-2 rounded-[1rem] bg-cyan-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500"
                  >
                    <Globe className="h-4 w-4" />
                    Import from URL
                  </button>
                </div>
              ) : null}

              {activeTab === "paste" ? (
                <div className="space-y-4">
                  <textarea
                    value={pastedText}
                    onChange={(event) => setPastedText(event.target.value)}
                    placeholder="Paste CSV or TSV rows here"
                    rows={10}
                    className="w-full rounded-[1rem] border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-900 outline-none dark:bg-slate-950/60 dark:text-slate-50"
                  />
                  <button
                    type="button"
                    onClick={() => void handlePasteImport()}
                    className="inline-flex items-center gap-2 rounded-[1rem] bg-cyan-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500"
                  >
                    <ClipboardPaste className="h-4 w-4" />
                    Import pasted data
                  </button>
                </div>
              ) : null}

              {activeTab === "samples" ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {SAMPLE_DATASETS.map((dataset) => (
                    <SampleDatasetCard
                      key={dataset.id}
                      dataset={dataset}
                      onLoad={(selected) => void handleSampleLoad(selected)}
                    />
                  ))}
                </div>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="space-y-4">
          <div className="rounded-[1.4rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-700 dark:text-sky-300">
                <currentTabMeta.icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  {currentTabMeta.label}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  DuckDB-backed import flow with client-side preview.
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[1rem] border border-white/15 bg-white/55 px-4 py-3 dark:bg-slate-950/25">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                  File Size
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-50">
                  {fileMeta ? formatBytes(fileMeta.size) : "Waiting for import"}
                </p>
              </div>
              <div className="rounded-[1rem] border border-white/15 bg-white/55 px-4 py-3 dark:bg-slate-950/25">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                  Encoding Hint
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-50">
                  {fileMeta?.encoding ?? "No file detected"}
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-[1rem] border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                <span>Uploads stay in-browser. DuckDB-WASM creates client-side tables only.</span>
              </div>
            </div>
          </div>

          <PreviewTable preview={preview} />
        </div>
      </div>
    </section>
  );
}
