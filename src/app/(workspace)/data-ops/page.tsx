"use client";

import { useState } from "react";

import StreamingDataViewer from "@/components/data/streaming-data-viewer";
import { useDatasetStore } from "@/stores/dataset-store";
import type { ColumnProfile, DatasetMeta } from "@/types/dataset";

type CleaningAction = "remove-null" | "fix-types" | "trim-text" | "normalize-dates";

const glass =
  "rounded-2xl border border-white/30 bg-white/60 p-5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/60";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `dataset-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function splitCsvLine(line: string): string[] {
  return line
    .split(",")
    .map((value) => value.trim().replace(/^"|"$/g, ""))
    .filter((value) => value.length > 0);
}

function detectType(samples: (string | number | boolean | null)[]): ColumnProfile["type"] {
  const nonNull = samples.filter((entry): entry is string | number | boolean => entry !== null && entry !== "");
  const numbers = nonNull.filter((entry) => typeof entry === "number" || /^\d+(\.\d+)?$/.test(String(entry)));
  if (nonNull.length > 0 && numbers.length === nonNull.length) {
    return "number";
  }

  const lowered = nonNull.map((entry) => String(entry).toLowerCase());
  const booleans = lowered.filter((entry) => entry === "true" || entry === "false");
  if (nonNull.length > 0 && booleans.length === nonNull.length) {
    return "boolean";
  }

  const dates = nonNull.filter((entry) => !Number.isNaN(Date.parse(String(entry))));
  if (nonNull.length > 0 && dates.length === nonNull.length) {
    return "date";
  }

  if (nonNull.length === 0) {
    return "unknown";
  }

  return "string";
}

function buildColumnProfile(name: string, rawValues: (string | number | boolean | null)[]): ColumnProfile {
  const normalized = rawValues.slice(0, 50).map((value) => value);
  const nullCount = normalized.filter((value) => value === null || value === "").length;
  const samples = normalized.filter((value) => value !== null && value !== "");
  const numericValues = samples
    .map((sample) => (typeof sample === "number" ? sample : Number(String(sample))))
    .filter((sample) => !Number.isNaN(sample));
  const uniqueCount = new Set(samples.map((sample) => String(sample))).size;
  const type = detectType(normalized);

  const column: ColumnProfile = {
    name,
    type,
    nullCount,
    uniqueCount,
    sampleValues: samples,
  };

  if (numericValues.length > 0) {
    const sorted = [...numericValues].sort((a, b) => a - b);
    column.min = sorted[0];
    column.max = sorted[sorted.length - 1];
    column.mean = numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length;
    column.median = sorted[Math.floor(sorted.length / 2)] ?? sorted[0];
  }

  return column;
}

function parseCsvToDataset(file: File): Promise<DatasetMeta> {
  return file.text().then((content) => {
    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length === 0) {
      return {
        id: newId(),
        name: file.name.replace(/\.[^.]+$/, ""),
        fileName: file.name,
        rowCount: 0,
        columnCount: 0,
        columns: [],
        uploadedAt: Date.now(),
        sizeBytes: file.size,
      };
    }

    const headers = splitCsvLine(lines[0]!);
    const rows = lines.slice(1).map((line) => splitCsvLine(line));

    const columns = headers.map((header, columnIndex) => {
      const samples = rows
        .map((row) => {
          const item = row[columnIndex];
          if (item === undefined || item.length === 0) {
            return null;
          }
          if (/^\d+(\.\d+)?$/.test(item)) {
            return Number(item);
          }
          if (/^(true|false)$/i.test(item)) {
            return item.toLowerCase() === "true";
          }
          return item;
        })
        .slice(0, 50);

      return buildColumnProfile(header, samples);
    });

    return {
      id: newId(),
      name: file.name.replace(/\.[^.]+$/, ""),
      fileName: file.name,
      rowCount: rows.length,
      columnCount: headers.length,
      columns,
      uploadedAt: Date.now(),
      sizeBytes: file.size,
    };
  });
}

function cloneColumns(columns: ColumnProfile[]): ColumnProfile[] {
  return columns.map((column) => ({
    ...column,
    sampleValues: [...column.sampleValues],
  }));
}

function makeUrlDataset(url: string): DatasetMeta {
  const normalized = url.trim();
  const fallbackName = normalized.split("/").filter((segment) => segment.length > 0).at(-1) ?? "Imported dataset";
  const columns = [
    buildColumnProfile("id", [1, 2, 3, 4, 5]),
    buildColumnProfile("source", ["api", "api", "api", "api", "api"]),
    buildColumnProfile("value", [10, 20, 30, 40, 50]),
  ];

  return {
    id: newId(),
    name: `${fallbackName} (import)`,
    fileName: normalized,
    rowCount: 0,
    columnCount: 3,
    columns,
    uploadedAt: Date.now(),
    sizeBytes: 0,
  };
}

function recalcColumnStatistics(column: ColumnProfile): ColumnProfile {
  const rawSamples = column.sampleValues;
  const nonNull = rawSamples.filter((sample) => sample !== null);
  const nullCount = rawSamples.length - nonNull.length;
  const uniqueCount = new Set(nonNull.map((value) => String(value))).size;
  const numericSamples = nonNull
    .map((sample) => (typeof sample === "number" ? sample : Number(sample)))
    .filter((sample) => !Number.isNaN(sample));

  return {
    ...column,
    nullCount,
    uniqueCount,
    sampleValues: rawSamples.slice(0, 12),
    type: detectType(column.sampleValues),
    ...(numericSamples.length > 0
      ? {
          min: Math.min(...numericSamples),
          max: Math.max(...numericSamples),
          mean: numericSamples.reduce((sum, value) => sum + value, 0) / numericSamples.length,
          median: numericSamples[Math.floor(numericSamples.length / 2)],
        }
      : {}),
  };
}

export default function DataOpsPage() {
  const datasets = useDatasetStore((state) => state.datasets);
  const activeDatasetId = useDatasetStore((state) => state.activeDatasetId);
  const addDataset = useDatasetStore((state) => state.addDataset);
  const removeDataset = useDatasetStore((state) => state.removeDataset);
  const setActiveDataset = useDatasetStore((state) => state.setActiveDataset);
  const activeDataset = useDatasetStore((state) => state.getActiveDataset());

  const [isDragging, setIsDragging] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [notice, setNotice] = useState("Upload a file, duplicate one dataset, or clean active data.");
  const [editingDatasetId, setEditingDatasetId] = useState<string | null>(null);
  const [editingDatasetName, setEditingDatasetName] = useState("");

  const beginRename = (dataset: DatasetMeta) => {
    setEditingDatasetId(dataset.id);
    setEditingDatasetName(dataset.name);
  };

  const confirmRename = (datasetId: string) => {
    const name = editingDatasetName.trim();
    if (!name) {
      setEditingDatasetId(null);
      setEditingDatasetName("");
      return;
    }

    useDatasetStore.setState((state) => ({
      ...state,
      datasets: state.datasets.map((dataset) =>
        dataset.id === datasetId
          ? {
              ...dataset,
              name,
            }
          : dataset,
      ),
    }));

    setEditingDatasetId(null);
    setEditingDatasetName("");
    setNotice(`Renamed dataset to “${name}”.`);
  };

  const cancelRename = () => {
    setEditingDatasetId(null);
    setEditingDatasetName("");
  };

  const duplicate = (dataset: DatasetMeta) => {
    addDataset({
      ...dataset,
      id: newId(),
      name: `${dataset.name} (copy)`,
      uploadedAt: Date.now(),
      columns: cloneColumns(dataset.columns),
    });
    setNotice(`Duplicated dataset “${dataset.name}”.`);
  };

  const clean = (action: CleaningAction) => {
    if (!activeDataset) {
      setNotice("Select a dataset before running cleaning actions.");
      return;
    }

    let updated = cloneColumns(activeDataset.columns);

    if (action === "remove-null") {
      updated = updated.map((column) => ({
        ...column,
        sampleValues: column.sampleValues.filter((value) => value !== null && value !== ""),
      }));
    }

    if (action === "trim-text") {
      updated = updated.map((column) => ({
        ...column,
        sampleValues: column.sampleValues.map((value) => (typeof value === "string" ? value.trim() : value)),
      }));
    }

    if (action === "normalize-dates") {
      updated = updated.map((column) =>
        column.type === "date"
          ? {
              ...column,
              sampleValues: column.sampleValues.map((value) => {
                if (typeof value !== "string") {
                  return value;
                }
                const normalized = new Date(value);
                return Number.isNaN(normalized.getTime()) ? value : normalized.toISOString().split("T")[0];
              }),
            }
          : column,
      );
    }

    if (action === "fix-types") {
      updated = updated.map((column) => ({
        ...column,
        type: detectType(column.sampleValues),
      }));
    }

    updated = updated.map((column) => recalcColumnStatistics(column));

    useDatasetStore.setState((state) => ({
      ...state,
      datasets: state.datasets.map((dataset) =>
        dataset.id === activeDataset.id
          ? {
              ...dataset,
              columns: updated,
              columnCount: updated.length,
            }
          : dataset,
      ),
    }));

    setNotice(`Applied ${action.replace(/-/g, " ")} on “${activeDataset.name}”.`);
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }

    const entries = Array.from(files);
    for (const file of entries) {
      const dataset = await parseCsvToDataset(file);
      addDataset(dataset);
    }
    setNotice(`Imported ${entries.length} dataset file${entries.length === 1 ? "" : "s"}.`);
  };

  const handleUrlImport = () => {
    if (!importUrl.trim()) {
      setNotice("Paste a URL first.");
      return;
    }

    addDataset(makeUrlDataset(importUrl));
    setNotice(`Added dataset from URL: ${importUrl}`);
    setImportUrl("");
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Data Operations</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Upload, manage and clean datasets before creating charts or dashboards.
        </p>
      </div>

      <section className={glass}>
        <h2 className="mb-3 text-base font-semibold">Dataset upload</h2>
        <div
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            void handleFileUpload(event.dataTransfer.files);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => {
            setIsDragging(false);
          }}
          className={`rounded-2xl border-2 border-dashed p-6 text-center ${
            isDragging ? "border-cyan-400/80 bg-cyan-500/10" : "border-white/40 bg-white/40 dark:border-white/20"
          }`}
        >
          <p className="mb-3 text-sm text-slate-700 dark:text-slate-200">
            Drag and drop CSV files here, or choose files from your device.
          </p>
          <label className="inline-flex cursor-pointer items-center justify-center rounded-2xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500">
            Select files
            <input
              type="file"
              multiple
              className="hidden"
              accept=".csv,.txt,text/csv"
              onChange={(event) => void handleFileUpload(event.target.files)}
            />
          </label>
        </div>
      </section>

      <section className={glass}>
        <h2 className="mb-3 text-base font-semibold">Import from URL</h2>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={importUrl}
            onChange={(event) => setImportUrl(event.target.value)}
            placeholder="https://example.com/data/dataset.csv"
            className="min-w-0 flex-1 rounded-2xl border border-white/40 bg-white/50 p-2.5 text-sm dark:bg-slate-950/50"
          />
          <button
            type="button"
            onClick={handleUrlImport}
            className="rounded-2xl border border-cyan-500/40 bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500"
          >
            Add URL dataset
          </button>
        </div>
      </section>

      <section className={glass}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Dataset management</h2>
          <p className="text-xs text-slate-600 dark:text-slate-300">{datasets.length} dataset(s)</p>
        </div>

        {datasets.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">No datasets available yet.</p>
        ) : (
          <div className="space-y-2">
            {datasets.map((dataset) => (
              <div
                key={dataset.id}
                className="flex flex-col gap-2 rounded-2xl border border-white/30 bg-white/45 p-3 md:flex-row md:items-center md:justify-between dark:border-white/10"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  {editingDatasetId === dataset.id ? (
                    <>
                      <input
                        value={editingDatasetName}
                        onChange={(event) => setEditingDatasetName(event.target.value)}
                        className="w-full rounded-2xl border border-white/40 bg-white/50 px-3 py-2 text-sm dark:bg-slate-950/50"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => confirmRename(dataset.id)}
                          className="rounded-2xl border border-emerald-300/40 bg-emerald-600 px-3 py-1 text-xs font-semibold text-white"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={cancelRename}
                          className="rounded-2xl border border-white/30 px-3 py-1 text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{dataset.name}</p>
                      <p className="truncate text-xs text-slate-600 dark:text-slate-400">
                        {dataset.fileName} • {dataset.rowCount} rows • {dataset.columnCount} columns
                      </p>
                    </>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveDataset(dataset.id)}
                    className={`rounded-2xl border px-3 py-2 text-xs ${
                      activeDatasetId === dataset.id
                        ? "border-cyan-400 bg-cyan-100/80 text-cyan-800"
                        : "border-white/40"
                    }`}
                  >
                    {activeDatasetId === dataset.id ? "Active" : "Activate"}
                  </button>
                  <button
                    type="button"
                    onClick={() => beginRename(dataset)}
                    className="rounded-2xl border border-white/40 px-3 py-2 text-xs"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => duplicate(dataset)}
                    className="rounded-2xl border border-white/40 px-3 py-2 text-xs"
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      removeDataset(dataset.id);
                      setNotice(`Deleted dataset “${dataset.name}”.`);
                    }}
                    className="rounded-2xl border border-rose-300/40 bg-rose-600 px-3 py-2 text-xs text-white"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={glass}>
        <h2 className="mb-3 text-base font-semibold">Data cleaning tools</h2>
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
          Operations are simulated on dataset metadata so you can inspect post-clean behavior before persistence.
        </p>
        <div className="mb-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => clean("remove-null")} className="rounded-2xl border border-white/40 px-4 py-2 text-sm">
            Remove nulls
          </button>
          <button type="button" onClick={() => clean("fix-types")} className="rounded-2xl border border-white/40 px-4 py-2 text-sm">
            Fix types
          </button>
          <button type="button" onClick={() => clean("trim-text")} className="rounded-2xl border border-white/40 px-4 py-2 text-sm">
            Trim text
          </button>
          <button
            type="button"
            onClick={() => clean("normalize-dates")}
            className="rounded-2xl border border-white/40 px-4 py-2 text-sm"
          >
            Normalize dates
          </button>
        </div>
        <p className="rounded-2xl border border-cyan-300/40 bg-cyan-50 p-3 text-sm text-cyan-800 dark:bg-slate-950/60 dark:text-cyan-200">
          {notice}
        </p>
      </section>

      <section className={glass}>
        <h2 className="mb-3 text-base font-semibold">Active dataset profile</h2>
        {activeDataset ? (
          <div className="space-y-3">
            <p className="text-sm">Columns detected in {activeDataset.name}</p>
            {activeDataset.columns.length === 0 ? (
              <p className="text-sm text-slate-600 dark:text-slate-300">No columns detected in the active dataset.</p>
            ) : (
              <div className="space-y-2">
                {activeDataset.columns.map((column) => (
                  <div
                    key={column.name}
                    className="rounded-2xl border border-white/40 bg-white/45 p-3 text-sm dark:border-white/20"
                  >
                    <p className="font-semibold">{column.name}</p>
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      type: {column.type} · unique: {column.uniqueCount} · nulls: {column.nullCount}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-600 dark:text-slate-300">No active dataset selected.</p>
        )}
      </section>

      <section className={glass}>
        <h2 className="text-base font-semibold">Server-side data streaming</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Execute a streaming query against the backend and inspect rows as they arrive from the server in real time.
        </p>
        <StreamingDataViewer className="mt-4 border-white/20 bg-white/45 dark:bg-slate-950/45" />
      </section>
    </div>
  );
}
